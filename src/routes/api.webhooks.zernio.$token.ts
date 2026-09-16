// Webhook público e exclusivo por usuário.
// A Zernio envia POST para /api/webhooks/zernio/$token onde $token é o webhook_token do profile.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptAndHeal, SecretUnavailableError } from "@/server/crypto.server";
import {
  zernioSendPrivateReply,
  zernioFindConversationId,
  zernioSendConversationMessage,
} from "@/server/zernio.server";
import {
  advanceFlowByClick,
  advanceFlowByText,
  flowMatchesComment,
  flowMatchesDm,
  runFlowFromComment,
  runFlowFromDm,
  type EngineResult,
  type FlowRow,
} from "@/server/flow-engine.server";
import { FLOW_PAYLOAD_RE } from "@/lib/flow-model";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Signature",
};

interface ZernioCommentEvent {
  id?: string;
  event?: string;
  comment?: {
    id?: string;
    platformPostId?: string;
    platform?: string;
    text?: string;
    author?: { id?: string; username?: string };
  };
  post?: { platformPostId?: string };
  account?: { id?: string; platform?: string; username?: string };
  timestamp?: string;
}

interface ZernioMessageEvent {
  id?: string;
  event?: string;
  message?: {
    id?: string;
    conversationId?: string;
    text?: string;
    quickReply?: { payload?: string };
    sender?: {
      id?: string;
      username?: string;
      instagramProfile?: { isFollower?: boolean | null };
    };
  };
  account?: { id?: string; username?: string };
  timestamp?: string;
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  // Chamada só com o filtro habilitado. Lista vazia = filtro inerte (match):
  // rows antigas em produção foram salvas assim e respondem a tudo — falhar
  // fechado aqui silenciaria essas automações. O guard de save impede criar
  // configurações novas nesse estado.
  if (!keywords || keywords.length === 0) return true;
  const t = text.toLowerCase();
  return keywords.some((k) => k.trim() && t.includes(k.trim().toLowerCase()));
}

function sameInstagramUsername(a?: string | null, b?: string | null): boolean {
  const normalize = (value: string) => value.trim().replace(/^@/, "").toLowerCase();
  return !!a && !!b && normalize(a) === normalize(b);
}

// Defensivo: jsonb do Supabase pode vir como string, array, ou null.
function parseJsonbArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

const GATE_DEFAULT_MESSAGE =
  "Esse conteúdo é exclusivo para seguidores! Me segue e clica em 'Pronto' de novo 😉";

// Payload gerado pelo gate carrega o id da automação dona: qr:<uuid>:gate
const ID_PAYLOAD_RE = /^qr:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):/i;

// Contadores atômicos no banco — read-modify-write em JS perdia contagens
// em webhooks concorrentes do mesmo usuário.
async function incrementCounters(
  automationId: string,
  sent: number,
  failed: number,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("increment_automation_counters", {
    aid: automationId,
    sent_delta: sent,
    failed_delta: failed,
  });
  if (error) console.error("[webhook] increment counters failed:", error.message);
}

// CTR real: clique registrado só quando passa do gate (a exibição do gate não
// conta; o re-clique pós-follow conta 1x — uma passagem de funil por usuário).
async function registerAutomationClick(id: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc("register_automation_click", { aid: id });
  if (error) console.error("[webhook] register automation click failed:", error.message);
}

async function registerFlowClick(id: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc("register_flow_click", { fid: id });
  if (error) console.error("[webhook] register flow click failed:", error.message);
}

function friendlyZernioError(raw: string): string {
  if (raw.includes("INBOX_REQUIRED")) {
    return "Sua conta Zernio não tem o addon Inbox ativo. Ative-o em zernio.com (Configurações → Addons).";
  }
  if (raw.includes("timeout")) {
    return `Zernio demorou para responder: ${raw}`;
  }
  return raw;
}

export const Route = createFileRoute("/api/webhooks/zernio/$token")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // GET para verificação de webhook (handshake de provedores e o teste
      // end-to-end do app). Só ecoa o challenge se o token existir — assim a
      // verificação prova que a URL aponta pra este app E o token é válido.
      GET: async ({ request, params }) => {
        const token = params.token;
        if (!token || token.length < 16) {
          return new Response("invalid token", { status: 401, headers: corsHeaders });
        }
        try {
          const { data: profile, error } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("webhook_token", token)
            .maybeSingle();
          if (error) throw error;
          if (!profile) {
            return new Response("unknown token", { status: 404, headers: corsHeaders });
          }
        } catch (e) {
          // Erro transiente de DB/env não pode reprovar um token válido no
          // handshake — fail-open (a validação de token aqui é hardening).
          console.error("[webhook] GET token check failed:", e);
        }
        const url = new URL(request.url);
        const challenge = url.searchParams.get("hub.challenge");
        if (challenge) return new Response(challenge, { status: 200, headers: corsHeaders });
        return new Response("ok", { status: 200, headers: corsHeaders });
      },

      POST: async ({ request, params }) => {
        // Wrapper geral: erros inesperados viram 2xx pra não criar tempestade
        // de retries. A indisponibilidade do segredo é tratada dentro do handler
        // e continua sendo a exceção deliberada (503 após desfazer o dedup).
        try {
          return await handleWebhookPost({ request, params });
        } catch (e) {
          console.error("[webhook] uncaught error:", e);
          return new Response(
            JSON.stringify({
              ok: true,
              error: "internal",
              message: e instanceof Error ? e.message : String(e),
            }),
            { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
          );
        }
      },
    },
  },
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

type LogPatch = {
  status?: string;
  error?: string | null;
  message_sent?: string | null;
  automation_id?: string | null;
  comment_text?: string | null;
  instagram_user?: string | null;
  instagram_post_id?: string | null;
};

async function updateLog(logId: string | null, patch: LogPatch): Promise<void> {
  if (!logId) return;
  const { error } = await supabaseAdmin.from("automation_logs").update(patch).eq("id", logId);
  if (error) console.error("[webhook] updateLog failed:", error.message);
}

async function handleWebhookPost({
  request,
  params,
}: {
  request: Request;
  params: { token: string };
}): Promise<Response> {
  const token = params.token;
  if (!token || token.length < 16) {
    return jsonResponse({ error: "invalid token" }, 401);
  }

  // Identifica o usuário pelo token
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("webhook_token", token)
    .maybeSingle();

  if (profileError) {
    console.error("[webhook] profile lookup failed:", profileError.message);
    return jsonResponse({ ok: true, error: "database_unavailable" });
  }
  if (!profile) return jsonResponse({ error: "unknown token" }, 404);
  const userId = profile.id;

  // Lê o body cru
  let rawBodyText = "";
  let rawPayload: ZernioCommentEvent & ZernioMessageEvent = {};
  try {
    rawBodyText = await request.text();
    if (rawBodyText) {
      rawPayload = JSON.parse(rawBodyText) as ZernioCommentEvent & ZernioMessageEvent;
    }
  } catch {
    // Cria log explícito de payload inválido
    const { error: invalidLogError } = await supabaseAdmin.from("automation_logs").insert({
      user_id: userId,
      status: "received",
      error: `invalid_json: ${rawBodyText.slice(0, 200)}`,
    });
    if (invalidLogError) {
      console.error("[webhook] invalid-json log insert failed:", invalidLogError.message);
    }
    return jsonResponse({ error: "invalid json" }, 400);
  }

  const eventType = rawPayload.event ?? "unknown";

  // ── DEDUP em duas fases: insert = "visto", processed_at = "concluído" ──
  // Retry/replay da Zernio (ela reenvia quando estoura o timeout dela) só é
  // descartado se o primeiro processamento CONCLUIU ou ainda está em voo (row
  // recente). Primeira tentativa morta no meio → o retry reprocessa em vez de
  // perder a DM pra sempre.
  const eventId = rawPayload.id ?? null;
  // Posse da row de dedup: true só quando ESTA tentativa inseriu ou reivindicou
  // a row. O unsee do respondSecretUnavailable exige posse — deletar a row de
  // uma tentativa concorrente que já enviou causaria private reply em dobro.
  let ownsDedupRow = false;
  if (eventId) {
    const { error: dupErr } = await supabaseAdmin
      .from("webhook_events")
      .insert({ user_id: userId, event_id: eventId });
    if (dupErr) {
      if (dupErr.code === "23505") {
        const { data: prior, error: priorError } = await supabaseAdmin
          .from("webhook_events")
          .select("created_at,processed_at")
          .eq("user_id", userId)
          .eq("event_id", eventId)
          .maybeSingle();
        if (priorError) {
          // O conflito prova que a row existe; sem conseguir ler seu estado, o
          // lado seguro é não arriscar uma DM duplicada.
          console.error("[webhook] dedup prior lookup failed:", priorError.message);
          return jsonResponse({ ok: true, ignored: "duplicate_event" });
        }
        const ageMs = prior ? Date.now() - new Date(prior.created_at).getTime() : 0;
        if (!prior || prior.processed_at || ageMs < 90_000) {
          return jsonResponse({ ok: true, ignored: "duplicate_event" });
        }
        // Primeira tentativa morreu sem concluir — reivindica o evento de novo.
        // Claim atômico: condiciona ao created_at antigo pra que apenas UM
        // retry concorrente vença (o perdedor vê 0 rows e descarta).
        const { data: claimed, error: claimError } = await supabaseAdmin
          .from("webhook_events")
          .update({ created_at: new Date().toISOString(), processed_at: null })
          .eq("user_id", userId)
          .eq("event_id", eventId)
          .eq("created_at", prior.created_at)
          .select("event_id");
        if (claimError) {
          console.error("[webhook] dedup reclaim failed:", claimError.message);
          return jsonResponse({ ok: true, ignored: "duplicate_event" });
        }
        if (!claimed || claimed.length === 0) {
          return jsonResponse({ ok: true, ignored: "duplicate_event" });
        }
        ownsDedupRow = true;
      } else {
        // Erro transiente no dedup não bloqueia o processamento (fail-open).
        console.error("[webhook] dedup insert failed:", dupErr.message);
      }
    } else {
      ownsDedupRow = true;
      // Limpeza oportunista de eventos >48h. Aguardada de propósito: o runtime
      // do Worker mata promises não aguardadas (o DELETE é indexado e barato).
      const { error: cleanupErr } = await supabaseAdmin
        .from("webhook_events")
        .delete()
        .lt("created_at", new Date(Date.now() - 48 * 3600 * 1000).toISOString());
      if (cleanupErr) console.error("[webhook] events cleanup failed:", cleanupErr.message);
    }
  }

  // Marca o evento como concluído — chamado após qualquer tentativa de envio
  // terminar (sucesso ou falha respondida). Skips leves não precisam: são
  // idempotentes se reprocessados.
  const markEventProcessed = async (): Promise<void> => {
    if (!eventId || !ownsDedupRow) return;
    const { error } = await supabaseAdmin
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("event_id", eventId);
    if (error) console.error("[webhook] mark processed failed:", error.message);
  };

  // Falha de INFRA ao carregar o segredo de criptografia (≠ chave errada):
  // "des-vê" o evento no dedup e responde 503 — exceção deliberada ao contrato
  // sempre-2xx, pro retry da Zernio reprocessar do zero em vez de a DM se
  // perder pra sempre com um log mandando re-salvar uma chave que está boa.
  const respondSecretUnavailable = async (logId: string | null, tag: string): Promise<Response> => {
    console.error(`[webhook/${tag}] segredo de criptografia indisponível — pedindo retry`);
    // Só apaga a row de dedup que ESTA tentativa possui. Sem posse, a row (se
    // existir) é de uma concorrente que pode já ter enviado — o retry pós-503
    // cai no dedup normal e é descartado se ela concluiu. Residual aceito: se
    // este delete falhar (degradação parcial de DB), retry <90s é engolido
    // pela janela in-flight; só um retry >90s reivindica o evento.
    if (eventId && ownsDedupRow) {
      const { error } = await supabaseAdmin
        .from("webhook_events")
        .delete()
        .eq("user_id", userId)
        .eq("event_id", eventId);
      if (error) console.error("[webhook] unsee event failed:", error.message);
    }
    await updateLog(logId, {
      status: "retrying",
      error:
        "Segredo de criptografia temporariamente indisponível — a Zernio vai reenviar; uma nova entrada aparecerá quando o retry for processado.",
    });
    return jsonResponse({ ok: false, error: "secret_unavailable" }, 503);
  };

  // ── LOG INICIAL SÍNCRONO: cria registro e guarda o id pra atualizar depois ──
  const { data: logRow, error: logInsertError } = await supabaseAdmin
    .from("automation_logs")
    .insert({
      user_id: userId,
      status: "received",
      comment_text: rawPayload.comment?.text ?? rawPayload.message?.text ?? null,
      instagram_user:
        rawPayload.comment?.author?.username ?? rawPayload.message?.sender?.username ?? null,
      instagram_post_id:
        rawPayload.comment?.platformPostId ?? rawPayload.post?.platformPostId ?? null,
      error: `event=${eventType}`,
    })
    .select("id")
    .maybeSingle();
  if (logInsertError) console.error("[webhook] initial log insert failed:", logInsertError.message);

  const logId = logRow?.id ?? null;

  const respondDatabaseError = async (tag: string, message: string): Promise<Response> => {
    console.error(`[webhook/${tag}] database query failed:`, message);
    await updateLog(logId, { status: "failed", error: `database_error/${tag}: ${message}` });
    return jsonResponse({ ok: true, error: "database_unavailable" });
  };

  // ── message.received ──
  if (eventType === "message.received" && rawPayload.message) {
    const msg = rawPayload.message;
    const senderId = msg.sender?.id;
    const senderUsername = msg.sender?.username;
    const payloadFromClick = msg.quickReply?.payload;
    const conversationId = msg.conversationId;
    const isFollower = msg.sender?.instagramProfile?.isFollower ?? null;

    if (!senderId || !conversationId) {
      await updateLog(logId, { status: "skipped", error: "incomplete_message" });
      return jsonResponse({ ok: true, ignored: "incomplete_message" });
    }

    if (sameInstagramUsername(senderUsername, rawPayload.account?.username)) {
      await updateLog(logId, { status: "skipped", error: "self_message" });
      return jsonResponse({ ok: true, ignored: "self_message" });
    }

    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("user_settings")
      .select("zernio_api_key_encrypted,zernio_account_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (settingsError) return respondDatabaseError("message/settings", settingsError.message);

    if (!settings?.zernio_api_key_encrypted || !settings?.zernio_account_id) {
      await updateLog(logId, { status: "skipped", error: "no_api_key_or_account" });
      return jsonResponse({ ok: true, skipped: "no_api_key" });
    }

    const storedCiphertext = settings.zernio_api_key_encrypted;
    let apiKey: string;
    try {
      // decryptAndHeal migra rows cifradas com segredo legado pro atual.
      apiKey = await decryptAndHeal(storedCiphertext, async (next) => {
        // CAS no ciphertext original: se o usuário salvou outra key no meio, 0 rows.
        const { error } = await supabaseAdmin
          .from("user_settings")
          .update({ zernio_api_key_encrypted: next })
          .eq("user_id", userId)
          .eq("zernio_api_key_encrypted", storedCiphertext);
        if (error) throw new Error(error.message);
      });
    } catch (e) {
      if (e instanceof SecretUnavailableError) {
        return respondSecretUnavailable(logId, "message");
      }
      const em = e instanceof Error ? e.message : String(e);
      console.error("[webhook/message] decrypt failed:", em);
      await updateLog(logId, {
        status: "failed",
        error: `decrypt_failed: ${em}. Salve a API Key novamente.`,
      });
      return jsonResponse({ ok: true, error: "decrypt_failed" });
    }

    // Helper: pede o follow antes de entregar (opt-in por automação). O payload
    // do botão "Pronto" carrega o id da automação — o clique pós-follow entrega
    // o conteúdo CERTO, não o da automação mais recente.
    const sendFollowerGate = async (automation: {
      id: string;
      follower_gate_message?: string | null;
    }): Promise<Response> => {
      let sent = false;
      try {
        await zernioSendConversationMessage({
          apiKey,
          accountId: settings.zernio_account_id!,
          conversationId,
          message: automation.follower_gate_message || GATE_DEFAULT_MESSAGE,
          quickReplies: [{ title: "Pronto! ✅", payload: `qr:${automation.id}:gate` }],
        });
        await updateLog(logId, {
          status: "sent",
          message_sent: "follower_gate",
          automation_id: automation.id,
        });
        sent = true;
      } catch (e) {
        const em = e instanceof Error ? e.message : String(e);
        await updateLog(logId, {
          status: "failed",
          automation_id: automation.id,
          error: `follower_gate: ${em}`,
        });
      }
      // Gate NÃO conta em total_sent/total_failed: o denominador do CTR é só a
      // mensagem-isca — contar o gate dobraria o denominador em funil gateado.
      await markEventProcessed();
      return jsonResponse({ ok: true, action: sent ? "follower_gate" : "follower_gate_failed" });
    };

    // Gate opt-in. isFollower null/ausente = status desconhecido: entrega sem
    // gate (fail-open) mas deixa rastro — gatear no escuro criaria loop pra
    // seguidores reais cujo evento de clique também vem sem isFollower.
    const gateApplies = (automation: { require_follow?: boolean | null }): boolean => {
      if (!automation.require_follow) return false;
      if (isFollower === false) return true;
      if (isFollower === null) {
        console.warn(
          "[webhook] require_follow ativo mas isFollower indisponível no evento — entregando sem gate",
        );
      }
      return false;
    };

    const engineCtx = () => ({
      userId,
      apiKey,
      accountId: settings.zernio_account_id!,
      conversationId,
      senderId,
    });

    // Resultado de flow → log + resposta padronizados.
    const respondFlowResult = async (flowName: string, result: EngineResult): Promise<Response> => {
      await updateLog(logId, {
        status: result.sent > 0 ? "sent" : result.failed > 0 ? "failed" : "skipped",
        message_sent: `[flow] ${flowName}: ${result.action}`,
        error: result.error ? friendlyZernioError(result.error) : null,
      });
      await markEventProcessed();
      return jsonResponse({ ok: true, flow: true, action: result.action, sent: result.sent });
    };

    // Gate de flow: o botão "Pronto" repete o payload original — o re-clique
    // pós-follow reavalia o gate (agora seguidor) e o flow segue de onde estava.
    const sendFlowGate = async (flow: FlowRow, replayPayload: string): Promise<Response> => {
      let sent = false;
      try {
        await zernioSendConversationMessage({
          apiKey,
          accountId: settings.zernio_account_id!,
          conversationId,
          message: flow.follower_gate_message || GATE_DEFAULT_MESSAGE,
          quickReplies: [{ title: "Pronto! ✅", payload: replayPayload }],
        });
        await updateLog(logId, {
          status: "sent",
          message_sent: `[flow] ${flow.name}: follower_gate`,
        });
        sent = true;
      } catch (e) {
        const em = e instanceof Error ? e.message : String(e);
        await updateLog(logId, { status: "failed", error: `follower_gate: ${em}` });
      }
      // Como no gate clássico: não conta em total_sent/total_failed (CTR).
      await markEventProcessed();
      return jsonResponse({ ok: true, action: sent ? "follower_gate" : "follower_gate_failed" });
    };

    if (payloadFromClick) {
      // Clique de flow: payload fl:<flowId>:<nodeId>:<handle> — stateless, o
      // payload nomeia o dono. Flow pausado/deletado = skip, nunca fallback.
      const flowClick = FLOW_PAYLOAD_RE.exec(payloadFromClick);
      if (flowClick) {
        const { data: flowRow, error: flowError } = await supabaseAdmin
          .from("flows")
          .select("*")
          .eq("id", flowClick[1].toLowerCase())
          .eq("user_id", userId)
          .maybeSingle();
        if (flowError) return respondDatabaseError("message/flow_click", flowError.message);
        if (!flowRow || !flowRow.is_active) {
          await updateLog(logId, { status: "skipped", error: "flow_owner_inactive" });
          return jsonResponse({ ok: true, ignored: "flow_owner_inactive" });
        }
        const flow = flowRow as unknown as FlowRow;
        if (gateApplies(flow)) return sendFlowGate(flow, payloadFromClick);
        // fl:<id>:start:run = gate de gatilho DM pedindo pra reexecutar do
        // início. Só vale a tupla exata E flow de DM — num flow de comentário
        // a reexecução começaria num privateReply sem comentário (dead-end).
        if (flowClick[2] === "start") {
          if (flowClick[3] === "run" && flow.trigger_type === "dm") {
            await registerFlowClick(flow.id);
            return respondFlowResult(
              flow.name,
              await runFlowFromDm(engineCtx(), flow, { countSent: false }),
            );
          }
          // Sem registerFlowClick: payload órfão descartado não é interação
          // que executou algo — contaria clique fantasma no CTR.
          await updateLog(logId, { status: "skipped", error: "flow_start_payload_invalido" });
          return jsonResponse({ ok: true, ignored: "flow_start_payload_invalido" });
        }
        await registerFlowClick(flow.id);
        const result = await advanceFlowByClick(engineCtx(), flow, flowClick[2], flowClick[3]);
        return respondFlowResult(flow.name, result);
      }
      const { data: autos, error: autosError } = await supabaseAdmin
        .from("automations")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (autosError) return respondDatabaseError("message/click_automations", autosError.message);

      const list = autos ?? [];

      // Resolve a automação DONA do clique, nesta ordem:
      // 1) payload prefixado com o id (qr:<uuid>:...) — gate e payloads novos.
      //    O payload NOMEIA o dono: se ele não está ativo, é skip, NUNCA
      //    fallback (entregaria a campanha errada).
      // 2) automação cujo quick_replies/botão postback contém o payload.
      // 3) fallback pra automação mais recente APENAS pro payload legado
      //    SEND_CONTENT (gates enviados antes desta versão). Payload órfão
      //    (dono pausado/deletado) é skip.
      const idMatch = ID_PAYLOAD_RE.exec(payloadFromClick);
      const ownsPayload = (a: (typeof list)[number]) =>
        parseJsonbArray<{ payload?: string }>(a.quick_replies).some(
          (q) => q.payload === payloadFromClick,
        ) ||
        parseJsonbArray<{ type?: string; payload?: string }>(a.buttons).some(
          (b) => b.type === "postback" && b.payload === payloadFromClick,
        );

      const matching = idMatch
        ? (list.find((a) => a.id === idMatch[1].toLowerCase()) ?? null)
        : (list.find(ownsPayload) ??
          (payloadFromClick === "SEND_CONTENT" ? (list[0] ?? null) : null));

      if (!matching) {
        await updateLog(logId, { status: "skipped", error: "payload_owner_inactive" });
        return jsonResponse({ ok: true, ignored: "payload_owner_inactive" });
      }

      // Gate opt-in: a automação exige seguir e o remetente não segue.
      if (gateApplies(matching)) {
        return sendFollowerGate(matching);
      }

      await registerAutomationClick(matching.id);

      const contentMessage =
        matching.followup_message || matching.custom_message || "Aqui está o conteúdo! 🎉";
      // Botões persistentes vão junto (o link do conteúdo costuma estar num
      // web_url). Quick replies só na entrega pós-gate — a mensagem original
      // com eles nunca chegou a esse usuário.
      const deliverButtons = parseJsonbArray<{
        type: string;
        title: string;
        payload?: string;
        url?: string;
      }>(matching.buttons);
      const deliverQuickReplies = payloadFromClick.endsWith(":gate")
        ? parseJsonbArray<{ title: string; payload: string }>(matching.quick_replies)
        : [];

      try {
        await zernioSendConversationMessage({
          apiKey,
          accountId: settings.zernio_account_id,
          conversationId,
          message: contentMessage,
          quickReplies: deliverQuickReplies.length > 0 ? deliverQuickReplies : undefined,
          buttons: deliverButtons.length > 0 ? deliverButtons : undefined,
        });
        await updateLog(logId, {
          status: "sent",
          message_sent: contentMessage,
          automation_id: matching.id,
        });
        // total_sent NÃO incrementa aqui: ele conta a mensagem-ISCA (a que
        // carrega os botões) — a entrega pós-clique já está em total_clicks.
        // Contar as duas inflaria o denominador do CTR (teto prático ~50%).
        await markEventProcessed();
        return jsonResponse({ ok: true, action: "content_delivered" });
      } catch (e) {
        const em = e instanceof Error ? e.message : String(e);
        await updateLog(logId, {
          status: "failed",
          automation_id: matching.id,
          error: `deliver: ${em}`,
        });
        await incrementCounters(matching.id, 0, 1);
        await markEventProcessed();
        return jsonResponse({ ok: true, action: "delivery_failed" });
      }
    }

    // DM direta sem quick reply.
    const messageText = msg.text || "";

    // 1º: sessão de flow ativa esperando RESPOSTA DE TEXTO nesta conversa
    // (nó condition). Sessão parada em nó de clique não engole o texto —
    // cai pros gatilhos normais.
    // Residual aceito: sem claim atômico — dois textos em <1-2s podem avançar
    // a mesma condition duas vezes (match E nomatch). Dano limitado a mensagem
    // duplicada; um claim com flip de status criaria risco de sessão presa.
    const { data: session, error: sessionError } = await supabaseAdmin
      .from("flow_sessions")
      .select("flow_id,current_node_id")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .eq("status", "active")
      .maybeSingle();
    if (sessionError) return respondDatabaseError("message/session", sessionError.message);
    if (session) {
      const { data: sessFlowRow, error: sessFlowError } = await supabaseAdmin
        .from("flows")
        .select("*")
        .eq("id", session.flow_id)
        .maybeSingle();
      if (sessFlowError) {
        return respondDatabaseError("message/session_flow", sessFlowError.message);
      }
      if (sessFlowRow?.is_active) {
        const sessFlow = sessFlowRow as unknown as FlowRow;
        const result = await advanceFlowByText(
          engineCtx(),
          sessFlow,
          session.current_node_id,
          messageText,
        );
        if (result.error !== "sessao_em_no_invalido") {
          return respondFlowResult(sessFlow.name, result);
        }
      } else {
        // Flow pausado/deletado com sessão pendurada: encerra pra ela não
        // ressuscitar como zumbi se o flow for reativado depois.
        const { error: closeSessionError } = await supabaseAdmin
          .from("flow_sessions")
          .update({ status: "completed" })
          .eq("user_id", userId)
          .eq("conversation_id", conversationId)
          .eq("flow_id", session.flow_id);
        if (closeSessionError) {
          console.error("[webhook] stale session cleanup failed:", closeSessionError.message);
        }
      }
    }

    // 2º: gatilho de flow por DM (keywords obrigatórias — sem elas o flow não
    // sequestra toda mensagem). Flow vence a automação clássica. Matching usa
    // select leve (sem os grafos JSONB); o grafo só é carregado pro vencedor.
    const { data: dmFlowMetas, error: dmFlowMetasError } = await supabaseAdmin
      .from("flows")
      .select("id,trigger_type,keywords")
      .eq("user_id", userId)
      .eq("is_active", true)
      .eq("trigger_type", "dm")
      .order("created_at", { ascending: false });
    if (dmFlowMetasError) {
      return respondDatabaseError("message/dm_flow_match", dmFlowMetasError.message);
    }
    const dmFlowMeta = (dmFlowMetas ?? []).find((f) => flowMatchesDm(f, messageText));
    if (dmFlowMeta) {
      const { data: fullRow, error: fullRowError } = await supabaseAdmin
        .from("flows")
        .select("*")
        .eq("id", dmFlowMeta.id)
        .maybeSingle();
      if (fullRowError) return respondDatabaseError("message/dm_flow", fullRowError.message);
      const matchingDmFlow = (fullRow as unknown as FlowRow) ?? null;
      if (matchingDmFlow) {
        if (gateApplies(matchingDmFlow)) {
          return sendFlowGate(matchingDmFlow, `fl:${matchingDmFlow.id}:start:run`);
        }
        const result = await runFlowFromDm(engineCtx(), matchingDmFlow);
        return respondFlowResult(matchingDmFlow.name, result);
      }
    }

    // 3º: automação clássica com trigger_on_dm.
    const { data: dmAutos, error: dmAutosError } = await supabaseAdmin
      .from("automations")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .eq("trigger_on_dm", true)
      .order("created_at", { ascending: false });
    if (dmAutosError) return respondDatabaseError("message/dm_automations", dmAutosError.message);

    const matchingDm = (dmAutos ?? []).find((a) => {
      if (a.keyword_filter_enabled && !matchesKeywords(messageText, a.keywords ?? [])) {
        return false;
      }
      return true;
    });

    if (!matchingDm) {
      await updateLog(logId, { status: "skipped", error: "no_dm_trigger_match" });
      return jsonResponse({ ok: true, ignored: "no_dm_trigger_match" });
    }

    // Gate opt-in: a automação exige seguir e o remetente não segue.
    if (gateApplies(matchingDm)) {
      return sendFollowerGate(matchingDm);
    }

    const dmMessage = matchingDm.followup_message || matchingDm.custom_message;
    const dmQuickReplies = parseJsonbArray<{ title: string; payload: string }>(
      matchingDm.quick_replies,
    );
    const dmButtons = parseJsonbArray<{
      type: string;
      title: string;
      payload?: string;
      url?: string;
    }>(matchingDm.buttons);

    if (!dmMessage.trim()) {
      await updateLog(logId, {
        status: "failed",
        automation_id: matchingDm.id,
        error: "dm_trigger: mensagem_vazia",
      });
      await incrementCounters(matchingDm.id, 0, 1);
      await markEventProcessed();
      return jsonResponse({ ok: true, action: "dm_trigger_failed" });
    }

    try {
      await zernioSendConversationMessage({
        apiKey,
        accountId: settings.zernio_account_id,
        conversationId,
        message: dmMessage,
        quickReplies: dmQuickReplies.length > 0 ? dmQuickReplies : undefined,
        buttons: dmButtons.length > 0 ? dmButtons : undefined,
      });
      await updateLog(logId, {
        status: "sent",
        automation_id: matchingDm.id,
        message_sent: dmMessage,
      });
      await incrementCounters(matchingDm.id, 1, 0);
      await markEventProcessed();
      return jsonResponse({ ok: true, action: "dm_trigger_sent" });
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      await updateLog(logId, {
        status: "failed",
        automation_id: matchingDm.id,
        error: `dm_trigger: ${em}`,
      });
      await incrementCounters(matchingDm.id, 0, 1);
      await markEventProcessed();
      return jsonResponse({ ok: true, action: "dm_trigger_failed" });
    }
  }

  // ── comment.received ──
  if (eventType !== "comment.received" || !rawPayload.comment) {
    await updateLog(logId, { status: "skipped", error: `ignored_event=${eventType}` });
    return jsonResponse({ ok: true, ignored: eventType });
  }

  const payload = rawPayload as ZernioCommentEvent;
  const pc = payload.comment!;
  const comment = {
    commentId: pc.id,
    text: pc.text || "",
    fromId: pc.author?.id,
    fromUsername: pc.author?.username,
    postId: pc.platformPostId || payload.post?.platformPostId,
  };

  if (!comment.commentId || !comment.fromId || !comment.postId) {
    await updateLog(logId, { status: "skipped", error: "incomplete_comment" });
    return jsonResponse({ ok: true, ignored: "incomplete_comment" });
  }

  // O dono respondendo comentários no próprio post não dispara automação
  // (mesmo guard que o message.received já tinha pra self_message).
  if (sameInstagramUsername(comment.fromUsername, payload.account?.username)) {
    await updateLog(logId, { status: "skipped", error: "self_comment" });
    return jsonResponse({ ok: true, ignored: "self_comment" });
  }

  // Narrowed non-null pra usar dentro do closure de background
  const commentId = comment.commentId;
  const fromId = comment.fromId;
  const postId = comment.postId;

  // Matching de flows usa select leve (sem os grafos JSONB de todos os flows);
  // o grafo completo só é carregado pro vencedor.
  const [settingsResult, autosResult, flowMetasResult] = await Promise.all([
    supabaseAdmin
      .from("user_settings")
      .select(
        "zernio_api_key_encrypted,zernio_account_id,outgoing_webhook_url,outgoing_webhook_enabled",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("automations")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("flows")
      .select("id,trigger_type,instagram_post_id,keyword_filter_enabled,keywords")
      .eq("user_id", userId)
      .eq("is_active", true)
      .eq("trigger_type", "comment")
      .order("created_at", { ascending: false }),
  ]);
  if (settingsResult.error) {
    return respondDatabaseError("comment/settings", settingsResult.error.message);
  }
  if (autosResult.error) {
    return respondDatabaseError("comment/automations", autosResult.error.message);
  }
  if (flowMetasResult.error) {
    return respondDatabaseError("comment/flows", flowMetasResult.error.message);
  }
  const settings = settingsResult.data;
  const autos = autosResult.data;
  const flowMetas = flowMetasResult.data;

  if (!settings?.zernio_api_key_encrypted || !settings?.zernio_account_id) {
    await updateLog(logId, { status: "skipped", error: "no_api_key_or_account" });
    return jsonResponse({ ok: true, skipped: "no_api_key_or_account" });
  }

  // Flow casando com o comentário vence a automação clássica (o flow é a
  // versão mais específica/completa da mesma intenção).
  const flowMeta = (flowMetas ?? []).find((f) => flowMatchesComment(f, postId, comment.text));
  let matchingFlow: FlowRow | null = null;
  if (flowMeta) {
    const { data: fullRow, error: fullRowError } = await supabaseAdmin
      .from("flows")
      .select("*")
      .eq("id", flowMeta.id)
      .maybeSingle();
    if (fullRowError) return respondDatabaseError("comment/flow", fullRowError.message);
    matchingFlow = (fullRow as unknown as FlowRow) ?? null;
  }

  const classicMatch = (autos ?? []).find((a) => {
    if (a.instagram_post_id !== "*" && a.instagram_post_id !== comment.postId) return false;
    if (a.keyword_filter_enabled && !matchesKeywords(comment.text, a.keywords ?? [])) return false;
    return true;
  });
  const matching = matchingFlow ? null : classicMatch;

  if (!matchingFlow && !matching) {
    await updateLog(logId, {
      status: "skipped",
      error: "Nenhuma automação compatível (post/keyword)",
    });
    return jsonResponse({ ok: true, skipped: "no_match" });
  }

  const storedCiphertext = settings.zernio_api_key_encrypted;
  let apiKey: string;
  try {
    apiKey = await decryptAndHeal(storedCiphertext, async (next) => {
      // CAS no ciphertext original: se o usuário salvou outra key no meio, 0 rows.
      const { error } = await supabaseAdmin
        .from("user_settings")
        .update({ zernio_api_key_encrypted: next })
        .eq("user_id", userId)
        .eq("zernio_api_key_encrypted", storedCiphertext);
      if (error) throw new Error(error.message);
    });
  } catch (e) {
    if (e instanceof SecretUnavailableError) {
      return respondSecretUnavailable(logId, "comment");
    }
    const em = e instanceof Error ? e.message : String(e);
    console.error("[webhook/comment] decrypt failed:", em);
    await updateLog(logId, {
      status: "failed",
      automation_id: matching?.id ?? null,
      error: `decrypt_failed: ${em}. Salve a API Key novamente.`,
    });
    return jsonResponse({ ok: true, error: "decrypt_failed" });
  }

  const accountId = settings.zernio_account_id;

  // ── Flow de comentário: o motor executa o grafo (private reply/mensagens) ──
  if (matchingFlow) {
    const result = await runFlowFromComment(
      { userId, apiKey, accountId, senderId: fromId, comment: { postId, commentId } },
      matchingFlow,
    );
    // Rastro de sombreamento: sem isso, a automação clássica do mesmo post
    // "para de funcionar" sem nenhuma pista no log.
    const shadowed = classicMatch ? ` (sombreou automação "${classicMatch.name}")` : "";
    await updateLog(logId, {
      status: result.sent > 0 ? "sent" : result.failed > 0 ? "failed" : "skipped",
      message_sent: `[flow] ${matchingFlow.name}: ${result.action}${shadowed}`,
      error: result.error ? friendlyZernioError(result.error) : null,
    });
    await markEventProcessed();
    return jsonResponse({ ok: true, flow: true, action: result.action, sent: result.sent });
  }
  if (!matching) {
    // Inalcançável (guard acima cobre), mas satisfaz o narrowing do TS.
    return jsonResponse({ ok: true, skipped: "no_match" });
  }

  const quickReplies = parseJsonbArray<{ title: string; payload: string }>(matching.quick_replies);
  const buttons = parseJsonbArray<{
    type: string;
    title: string;
    payload?: string;
    url?: string;
  }>(matching.buttons);

  const hasFollowup = !!matching.followup_message || quickReplies.length > 0 || buttons.length > 0;

  const notifyOutgoingWebhook = async (messageSent: string): Promise<void> => {
    if (!settings.outgoing_webhook_enabled || !settings.outgoing_webhook_url) return;
    // Integração do cliente não pode consumir indefinidamente o orçamento
    // síncrono do webhook principal. HTTP 4xx/5xx também é falha (fetch não
    // rejeita nesses status).
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const outgoingResponse = await fetch(settings.outgoing_webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "dm.sent",
          automation_id: matching.id,
          instagram_user: comment.fromUsername,
          comment_text: comment.text,
          message_sent: messageSent,
          timestamp: new Date().toISOString(),
        }),
        signal: controller.signal,
      });
      if (!outgoingResponse.ok) {
        console.error(
          "[webhook/comment] outgoing webhook failed:",
          outgoingResponse.status,
          outgoingResponse.statusText,
        );
      }
    } catch (e) {
      console.error("[webhook/comment] outgoing webhook failed:", e);
    } finally {
      clearTimeout(timeout);
    }
  };

  // ══════════════════════════════════════════════════════════════════
  // PROCESSAMENTO SÍNCRONO
  //
  // Tentamos background (waitUntil) antes mas o runtime do CF Worker
  // mata a promise mesmo com waitUntil retornado com sucesso — então
  // aguardamos tudo e respondemos no fim.
  //
  // Orçamento pior caso ≈ 11s (private 4s ∥ findConv 3s → retry 3s →
  // follow-up 4s); na prática <4s (chamadas reais <2s). Se a Zernio
  // estourar o timeout ~10s dela e reenviar o evento, o dedup por
  // event_id (webhook_events) bloqueia o reprocessamento.
  // ══════════════════════════════════════════════════════════════════

  const processCommentEvent = async () => {
    // custom_message vazia = automação "somente follow-up" (legado suportado):
    // pula o private reply SEM tratar como falha e segue pro follow-up.
    const primarySkipped = !matching.custom_message.trim();
    let primarySent = false;
    let primaryErr: string | null = null;
    let followupSent = false;
    let followupErr: string | null = null;

    const privateReplyPromise = primarySkipped
      ? Promise.resolve({ ok: true as const })
      : zernioSendPrivateReply({
          apiKey,
          accountId,
          postId,
          commentId,
          message: matching.custom_message,
        })
          .then(() => ({ ok: true as const }))
          .catch((e) => ({ ok: false as const, err: e instanceof Error ? e.message : String(e) }));

    const findConvPromise = hasFollowup
      ? zernioFindConversationId({
          apiKey,
          accountId,
          participantId: fromId,
        })
      : Promise.resolve(null);

    const [primaryRes, convId1] = await Promise.all([privateReplyPromise, findConvPromise]);

    if (primaryRes.ok) {
      if (!primarySkipped) {
        primarySent = true;
        console.log("[webhook/comment] private reply sent ok");
      }
    } else {
      primaryErr = "err" in primaryRes ? primaryRes.err : "unknown";
      console.error("[webhook/comment] private reply failed:", primaryErr);
    }

    // dm.sent só quando uma mensagem saiu de verdade — primaryRes.ok é
    // verdadeiro por vácuo quando a isca foi pulada (só-follow-up). Com isca
    // enviada, começa em paralelo pra não somar seu timeout ao pior caso find
    // conversation → mensagem.
    let outgoingPromise = primarySent
      ? notifyOutgoingWebhook(matching.custom_message)
      : Promise.resolve();

    if (primaryRes.ok && hasFollowup) {
      let conversationId = convId1;
      if (!conversationId) {
        console.log("[webhook/comment] conv not found in 1st pass, retrying...");
        conversationId = await zernioFindConversationId({
          apiKey,
          accountId,
          participantId: fromId,
        });
      }

      if (conversationId) {
        const followupParams = {
          apiKey,
          accountId,
          conversationId,
          message: matching.followup_message || matching.custom_message,
          quickReplies: quickReplies.length > 0 ? quickReplies : undefined,
          buttons: buttons.length > 0 ? buttons : undefined,
        };
        try {
          await zernioSendConversationMessage(followupParams);
          followupSent = true;
          console.log("[webhook/comment] follow-up sent ok");
        } catch (err) {
          followupErr = err instanceof Error ? err.message : String(err);
          console.error("[webhook/comment] follow-up failed:", followupErr);
        }
      } else {
        followupErr = "conversation not found after retry";
        console.warn("[webhook/comment] follow-up skipped: conv not found");
      }
    }

    // O que o follow-up realmente entrega: zernioSendConversationMessage cai
    // pra "👇" quando não há texto nenhum (só quick replies/botões).
    const followupDelivered = matching.followup_message || matching.custom_message || "👇";

    if (!primarySent && followupSent) {
      // Só-follow-up: o único envio real é o follow-up, então o dm.sent só
      // dispara agora, com a mensagem que de fato saiu. Custa até +2s no fim —
      // nesse caminho não há nada pra paralelizar (pior caso 3+3+4+2 = 12s,
      // ainda coberto pela janela de 90s do dedup).
      outgoingPromise = notifyOutgoingWebhook(followupDelivered);
    }

    // "sent" = alguma mensagem saiu de verdade. Só-follow-up sem nada enviável
    // (nem followup) vira "skipped" sem mexer em contador — não é falha.
    const anySent = primarySent || followupSent;
    const nothingToSend = primarySkipped && !hasFollowup;
    const finalStatus = anySent ? "sent" : nothingToSend ? "skipped" : "failed";
    const rawErr = nothingToSend ? "automacao_sem_mensagem" : primaryErr || followupErr;
    const finalErr = rawErr ? friendlyZernioError(rawErr) : null;

    try {
      await updateLog(logId, {
        automation_id: matching.id,
        message_sent: primarySent
          ? matching.custom_message
          : followupSent
            ? followupDelivered
            : null,
        status: finalStatus,
        error: finalErr,
      });
      if (!nothingToSend) {
        await incrementCounters(matching.id, anySent ? 1 : 0, anySent ? 0 : 1);
      }
    } catch (e) {
      console.error("[webhook/comment] post-processing failed:", e);
    }
    // Fora do try acima: mesmo que log/contador lance por falha de rede, a
    // promise já iniciada continua sendo aguardada (nada fire-and-forget).
    await outgoingPromise;

    return { primarySent: anySent, followupSent, finalErr };
  };

  // Síncrono: aguarda tudo antes de responder.
  const result = await processCommentEvent();
  await markEventProcessed();

  return jsonResponse({
    ok: true,
    sent: result.primarySent,
    followup_sent: result.followupSent,
    debug: {
      automation_id: matching.id,
      has_custom_message: !!matching.custom_message,
      has_followup_message: !!matching.followup_message,
      quick_replies_count: quickReplies.length,
      buttons_count: buttons.length,
    },
    error: result.finalErr,
  });
}
