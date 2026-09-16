// Motor de execução dos flows (server-only, chamado pelo webhook).
//
// Contrato com o webhook síncrono do CF Worker (~11s de orçamento):
// - executeChain caminha pelo grafo a partir de um nó e PARA em qualquer ponto
//   de interação: mensagem com quick replies/botões postback (o clique traz o
//   payload fl:<flow>:<node>:<handle>, stateless) ou nó condition (grava
//   flow_sessions e espera a próxima resposta de texto).
// - Hard-stop em MAX_SENDS_PER_EVENT envios por evento — o builder valida isso
//   antes de ativar, o motor garante em runtime.
// - privateReply + message em sequência roda findConversationId em PARALELO
//   com a private reply (mesmo truque do caminho clássico de comentário).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  zernioSendPrivateReply,
  zernioFindConversationId,
  zernioSendConversationMessage,
} from "@/server/zernio.server";
import {
  MAX_SENDS_PER_EVENT,
  flowClickPayload,
  outgoingEdge,
  parseJsonbEdges,
  parseJsonbNodes,
  type ConditionNodeData,
  type FlowEdge,
  type FlowNode,
  type MessageNodeData,
  type PrivateReplyNodeData,
} from "@/lib/flow-model";

export interface FlowRow {
  id: string;
  user_id: string;
  name: string;
  is_active: boolean;
  trigger_type: string;
  instagram_post_id: string | null;
  instagram_post_type: string;
  keyword_filter_enabled: boolean;
  keywords: string[] | null;
  require_follow: boolean;
  follower_gate_message: string | null;
  nodes: unknown;
  edges: unknown;
}

export interface EngineContext {
  userId: string;
  apiKey: string;
  accountId: string;
  /** Conversa conhecida (eventos de mensagem/clique). */
  conversationId?: string | null;
  /** Id do participante — pra descobrir a conversa após private reply. */
  senderId?: string | null;
  /** Contexto de comentário (só em comment.received). */
  comment?: { postId: string; commentId: string } | null;
}

export interface EngineResult {
  sent: number;
  failed: number;
  action: string;
  error?: string;
}

async function upsertSession(
  userId: string,
  conversationId: string,
  flowId: string,
  nodeId: string,
): Promise<boolean> {
  const { error } = await supabaseAdmin.from("flow_sessions").upsert(
    {
      user_id: userId,
      conversation_id: conversationId,
      flow_id: flowId,
      current_node_id: nodeId,
      status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,conversation_id" },
  );
  if (error) {
    console.error("[flow] upsert session failed:", error.message);
    return false;
  }
  return true;
}

// Encerra APENAS a sessão do próprio flow: um clique stateless num botão
// antigo do flow A não pode matar a espera de condition ativa do flow B na
// mesma conversa.
async function completeSession(
  userId: string,
  conversationId: string,
  flowId: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("flow_sessions")
    .update({ status: "completed" })
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .eq("flow_id", flowId);
  if (error) console.error("[flow] complete session failed:", error.message);
}

/** Sessões ativas de um flow — chamado quando o flow é pausado/editado. */
export async function completeFlowSessions(flowId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("flow_sessions")
    .update({ status: "completed" })
    .eq("flow_id", flowId)
    .eq("status", "active");
  if (error) console.error("[flow] complete flow sessions failed:", error.message);
}

export async function incrementFlowCounters(
  flowId: string,
  sent: number,
  failed: number,
): Promise<void> {
  if (sent === 0 && failed === 0) return;
  const { error } = await supabaseAdmin.rpc("increment_flow_counters", {
    fid: flowId,
    sent_delta: sent,
    failed_delta: failed,
  });
  if (error) console.error("[flow] increment counters failed:", error.message);
}

function messagePayloads(
  flow: FlowRow,
  node: FlowNode,
): {
  quickReplies: { title: string; payload: string }[];
  buttons: { type: string; title: string; payload?: string; url?: string }[];
  hasInteraction: boolean;
} {
  const data = node.data as MessageNodeData;
  // Handle preferencial: id ESTÁVEL da branch (qr-<id>/btn-<id>) — imune a
  // reordenação/remoção de botões em edições futuras. Fallback pro índice no
  // array ORIGINAL do node (legado) — nunca no array filtrado, que reindexa e
  // desalinharia o payload da edge.
  const quickReplies = (data.quickReplies ?? [])
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => q.title?.trim())
    .map(({ q, i }) => ({
      title: q.title,
      payload: flowClickPayload(flow.id, node.id, q.id ? `qr-${q.id}` : `qr-${i}`),
    }));
  const buttons = (data.buttons ?? [])
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.title?.trim())
    .map(({ b, i }) =>
      b.type === "web_url"
        ? { type: "web_url", title: b.title, url: b.url ?? "" }
        : {
            type: "postback",
            title: b.title,
            payload: flowClickPayload(flow.id, node.id, b.id ? `btn-${b.id}` : `btn-${i}`),
          },
    );
  const hasInteraction = quickReplies.length > 0 || buttons.some((b) => b.type === "postback");
  return { quickReplies, buttons, hasInteraction };
}

/**
 * Executa o grafo a partir de startNodeId até um ponto de espera (interação,
 * condition), o fim do caminho, ou o teto de envios. Retorna métricas pro log.
 */
export async function executeChain(
  ctx: EngineContext,
  flow: FlowRow,
  startNodeId: string,
  options: { countSent?: boolean } = {},
): Promise<EngineResult> {
  const nodes = parseJsonbNodes(flow.nodes);
  const edges = parseJsonbEdges(flow.edges);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  let sent = 0;
  let failed = 0;
  const actions: string[] = [];
  let lastError: string | undefined;
  let conversationId = ctx.conversationId ?? null;
  // Descoberta antecipada da conversa: se a cadeia começa num privateReply e
  // vamos precisar da conversa logo depois, o find roda em paralelo.
  let findConvPromise: Promise<string | null> | null = null;
  let sentPrivateReplyNow = false;
  const ensureFindStarted = () => {
    if (!conversationId && !findConvPromise && ctx.senderId) {
      findConvPromise = zernioFindConversationId({
        apiKey: ctx.apiKey,
        accountId: ctx.accountId,
        participantId: ctx.senderId,
      });
    }
  };
  // Resolve a conversa com no máximo 1 retry — e SÓ quando uma private reply
  // acabou de ser enviada nesta execução (o retry existe pra cobrir o lag da
  // conversa recém-criada aparecer na listagem; sem private reply, se o
  // primeiro find não achou, o retry também não acha e só queima orçamento).
  const resolveConversation = async (): Promise<string | null> => {
    ensureFindStarted();
    let conv = findConvPromise ? await findConvPromise : null;
    if (!conv && sentPrivateReplyNow && ctx.senderId) {
      conv = await zernioFindConversationId({
        apiKey: ctx.apiKey,
        accountId: ctx.accountId,
        participantId: ctx.senderId,
      });
    }
    return conv;
  };

  let cur: FlowNode | undefined = nodeById.get(startNodeId);
  const visited = new Set<string>();

  while (cur) {
    if (visited.has(cur.id)) {
      lastError = "flow_cycle_detected";
      break;
    }
    visited.add(cur.id);

    if (cur.type === "trigger") {
      const next = outgoingEdge(edges, cur.id, "out");
      cur = next ? nodeById.get(next.target) : undefined;
      continue;
    }

    if (sent >= MAX_SENDS_PER_EVENT && (cur.type === "privateReply" || cur.type === "message")) {
      lastError = "send_budget_exhausted";
      console.error(`[flow ${flow.id}] orçamento de envios estourado no nó ${cur.id}`);
      break;
    }

    if (cur.type === "privateReply") {
      if (!ctx.comment) {
        lastError = "private_reply_sem_comentario";
        break;
      }
      const data = cur.data as PrivateReplyNodeData;
      // Se o caminho continua, a descoberta da conversa roda em paralelo.
      const next = outgoingEdge(edges, cur.id, "out");
      if (next) ensureFindStarted();
      try {
        await zernioSendPrivateReply({
          apiKey: ctx.apiKey,
          accountId: ctx.accountId,
          postId: ctx.comment.postId,
          commentId: ctx.comment.commentId,
          message: data.text ?? "",
        });
        sent += 1;
        sentPrivateReplyNow = true;
        actions.push("private_reply");
      } catch (e) {
        failed += 1;
        lastError = e instanceof Error ? e.message : String(e);
        break; // opener falhou: não adianta seguir a cadeia
      }
      cur = next ? nodeById.get(next.target) : undefined;
      continue;
    }

    if (cur.type === "message") {
      if (!conversationId) conversationId = await resolveConversation();
      if (!conversationId) {
        failed += 1;
        lastError = "conversa_nao_encontrada";
        break;
      }
      const data = cur.data as MessageNodeData;
      const { quickReplies, buttons, hasInteraction } = messagePayloads(flow, cur);
      try {
        await zernioSendConversationMessage({
          apiKey: ctx.apiKey,
          accountId: ctx.accountId,
          conversationId,
          message: data.text ?? "",
          quickReplies,
          buttons,
        });
        sent += 1;
        actions.push(`message:${cur.id}`);
      } catch (e) {
        failed += 1;
        lastError = e instanceof Error ? e.message : String(e);
        break;
      }
      if (hasInteraction) {
        // Espera clique — payload é stateless, sessão vira rastro do ponto atual.
        if (!(await upsertSession(ctx.userId, conversationId, flow.id, cur.id))) {
          lastError = "session_upsert_failed";
        }
        break;
      }
      const next = outgoingEdge(edges, cur.id, "out");
      cur = next ? nodeById.get(next.target) : undefined;
      continue;
    }

    if (cur.type === "condition") {
      // Condition precisa de conversa pra amarrar a sessão de espera.
      if (!conversationId) conversationId = await resolveConversation();
      if (!conversationId) {
        lastError = "condition_sem_conversa";
        break;
      }
      if (!(await upsertSession(ctx.userId, conversationId, flow.id, cur.id))) {
        failed += 1;
        lastError = "session_upsert_failed";
        break;
      }
      actions.push(`waiting:${cur.id}`);
      break;
    }

    break; // tipo desconhecido: para com segurança
  }

  // Fim de caminho sem espera: marca a sessão deste flow (se houver) como
  // concluída — sessão de OUTRO flow na mesma conversa fica intacta.
  if (!cur && conversationId && !actions.some((a) => a.startsWith("waiting:"))) {
    await completeSession(ctx.userId, conversationId, flow.id);
  }

  // Cliques representam a entrega posterior à mensagem-isca. Contar esses
  // envios em total_sent inflaria o denominador do CTR; falhas continuam sendo
  // registradas para diagnóstico, como no caminho clássico.
  await incrementFlowCounters(flow.id, options.countSent === false ? 0 : sent, failed);
  return {
    sent,
    failed,
    action: actions.join(",") || "noop",
    error: lastError,
  };
}

/** Gatilho: comentário casou com o flow → executa a partir do trigger. */
export async function runFlowFromComment(
  ctx: EngineContext,
  flow: FlowRow,
  options?: { countSent?: boolean },
): Promise<EngineResult> {
  const nodes = parseJsonbNodes(flow.nodes);
  const trigger = nodes.find((n) => n.type === "trigger");
  if (!trigger) return { sent: 0, failed: 0, action: "noop", error: "flow_sem_trigger" };
  return executeChain(ctx, flow, trigger.id, options);
}

/** Gatilho: DM com keyword casou com o flow → executa a partir do trigger. */
export async function runFlowFromDm(
  ctx: EngineContext,
  flow: FlowRow,
  options?: { countSent?: boolean },
): Promise<EngineResult> {
  return runFlowFromComment(ctx, flow, options);
}

/** Clique em quick reply/botão com payload fl:<flow>:<node>:<handle>. */
export async function advanceFlowByClick(
  ctx: EngineContext,
  flow: FlowRow,
  nodeId: string,
  handle: string,
): Promise<EngineResult> {
  const edges = parseJsonbEdges(flow.edges);
  // Match SÓ por identidade exata do handle. Payload posicional (qr-0/btn-0)
  // contra grafo re-salvo com ids = flow editado desde a emissão — resolver
  // pela posição ATUAL entregaria a branch errada; dead-end é o seguro.
  const edge = edges.find((e) => e.source === nodeId && (e.sourceHandle ?? "out") === handle);
  if (!edge) {
    // Clique num botão sem continuação — fim de caminho legítimo.
    if (ctx.conversationId) await completeSession(ctx.userId, ctx.conversationId, flow.id);
    return { sent: 0, failed: 0, action: "click_sem_continuacao" };
  }
  return executeChain(ctx, flow, edge.target, { countSent: false });
}

/**
 * Resposta de texto com sessão ativa esperando num nó condition:
 * avalia keywords → segue match/nomatch.
 */
export async function advanceFlowByText(
  ctx: EngineContext,
  flow: FlowRow,
  waitingNodeId: string,
  text: string,
): Promise<EngineResult> {
  const nodes = parseJsonbNodes(flow.nodes);
  const edges = parseJsonbEdges(flow.edges);
  const node = nodes.find((n) => n.id === waitingNodeId);
  if (!node || node.type !== "condition") {
    // Sessão apontando pra nó que não existe mais (flow editado) ou que não
    // espera texto: encerra pra não prender a conversa pra sempre — o caller
    // cai pros gatilhos normais.
    if (ctx.conversationId) await completeSession(ctx.userId, ctx.conversationId, flow.id);
    return { sent: 0, failed: 0, action: "noop", error: "sessao_em_no_invalido" };
  }
  const data = node.data as ConditionNodeData;
  const t = text.toLowerCase();
  const matched = (data.keywords ?? []).some((k) => k.trim() && t.includes(k.trim().toLowerCase()));
  const handle = matched ? "match" : "nomatch";
  const edge = edges.find((e) => e.source === waitingNodeId && e.sourceHandle === handle) as
    | FlowEdge
    | undefined;
  if (!edge) {
    // Sem saída pro resultado: encerra a espera (senão a sessão prende a
    // conversa pra sempre).
    if (ctx.conversationId) await completeSession(ctx.userId, ctx.conversationId, flow.id);
    return { sent: 0, failed: 0, action: `condition_${handle}_sem_saida` };
  }
  return executeChain(ctx, flow, edge.target);
}

/** Matching de gatilho de comentário (mesma semântica das automações clássicas).
 * Aceita row leve — o webhook faz o matching sem carregar os grafos JSONB. */
export function flowMatchesComment(
  flow: Pick<FlowRow, "trigger_type" | "instagram_post_id" | "keyword_filter_enabled" | "keywords">,
  commentPostId: string,
  commentText: string,
): boolean {
  if (flow.trigger_type !== "comment") return false;
  if (flow.instagram_post_id !== "*" && flow.instagram_post_id !== commentPostId) {
    return false;
  }
  if (flow.keyword_filter_enabled) {
    const t = commentText.toLowerCase();
    const kws = (flow.keywords ?? []).filter((k) => k.trim());
    // Lista vazia = filtro inerte (fail-open): rows antigas em produção foram
    // salvas assim e respondiam a tudo. O guard de save impede criar novas.
    if (kws.length > 0 && !kws.some((k) => t.includes(k.trim().toLowerCase()))) return false;
  }
  return true;
}

/** Matching de gatilho de DM (keywords obrigatórias pra não sequestrar toda DM). */
export function flowMatchesDm(
  flow: Pick<FlowRow, "trigger_type" | "keywords">,
  messageText: string,
): boolean {
  if (flow.trigger_type !== "dm") return false;
  const kws = (flow.keywords ?? []).filter((k) => k.trim());
  if (kws.length === 0) return false;
  const t = messageText.toLowerCase();
  return kws.some((k) => t.includes(k.trim().toLowerCase()));
}
