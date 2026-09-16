// Modelo do flow compartilhado entre o builder (client) e o motor (server).
//
// Semântica de execução (restrições reais da Zernio/Instagram):
// - trigger: âncora visual; a config (post/keywords/gate) vive nas colunas do
//   flow. Saída única "out".
// - privateReply: DM privada respondendo um COMENTÁRIO (opener). Texto puro,
//   sem janela de 24h. Só é executável em eventos de comentário. Saída "out".
// - message: mensagem na conversa (exige janela de 24h). Até 13 quick replies
//   e 3 botões. Cada quick reply (qr-<i>) e botão postback (btn-<i>) é um
//   handle de saída — o clique avança o flow (payload fl:<flow>:<node>:<handle>,
//   stateless). Sem interações, pode ter saída "out" pra encadear o próximo nó.
// - condition: não envia nada; grava sessão esperando a PRÓXIMA resposta de
//   texto. match/nomatch são os handles de saída.
//
// Orçamento do webhook síncrono (~11s; envio ≈4s, findConversation ≈3s):
// no máximo MAX_SENDS_PER_EVENT envios por evento — validação no builder e
// hard-stop no motor.

export const MAX_QUICK_REPLIES = 13;
export const MAX_BUTTONS = 3;
export const MAX_SENDS_PER_EVENT = 2;

export type FlowNodeType = "trigger" | "privateReply" | "message" | "condition";

export interface TriggerNodeData {
  [key: string]: unknown;
}

export interface PrivateReplyNodeData {
  text: string;
  [key: string]: unknown;
}

export interface FlowQuickReply {
  title: string;
  /** Id ESTÁVEL da branch de origem — vira o handle do clique (qr-<id>).
   * Sem ele, o handle cai pro índice (legado) e reordenar/remover misroteia
   * cliques de mensagens já enviadas. */
  id?: string;
}

export interface FlowButton {
  type: "web_url" | "postback";
  title: string;
  url?: string;
  /** Id estável da branch (postback) — handle btn-<id>; ver FlowQuickReply.id. */
  id?: string;
}

export interface MessageNodeData {
  text: string;
  quickReplies: FlowQuickReply[];
  buttons: FlowButton[];
  [key: string]: unknown;
}

export interface ConditionNodeData {
  keywords: string[];
  [key: string]: unknown;
}

export type FlowNodeData =
  | TriggerNodeData
  | PrivateReplyNodeData
  | MessageNodeData
  | ConditionNodeData;

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
}

// Payload de clique: fl:<flowId>:<nodeId>:<handle>
export const FLOW_PAYLOAD_RE =
  /^fl:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([^:]+):(.+)$/i;

export function flowClickPayload(flowId: string, nodeId: string, handle: string): string {
  return `fl:${flowId}:${nodeId}:${handle}`;
}

export function parseJsonbNodes(raw: unknown): FlowNode[] {
  if (Array.isArray(raw)) return raw as FlowNode[];
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

export function parseJsonbEdges(raw: unknown): FlowEdge[] {
  return parseJsonbNodes(raw) as unknown as FlowEdge[];
}

export function outgoingEdge(
  edges: FlowEdge[],
  nodeId: string,
  handle: string,
): FlowEdge | undefined {
  return edges.find((e) => e.source === nodeId && (e.sourceHandle ?? "out") === handle);
}

export interface FlowValidationIssue {
  nodeId: string | null;
  message: string;
}

/**
 * Validação estrutural — roda no builder (feedback ao vivo) e no servidor
 * (antes de ativar um flow). Regras derivadas das restrições da plataforma,
 * não de gosto: violar aqui significa flow que falha em produção.
 */
export function validateFlow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  triggerType: string,
): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];
  const triggers = nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) {
    issues.push({
      nodeId: null,
      message: "O flow precisa de exatamente 1 nó de gatilho.",
    });
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({ nodeId: node.id, message: `Id de nó duplicado ("${node.id}").` });
    }
    nodeIds.add(node.id);
  }
  const edgeSlots = new Set<string>();
  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      issues.push({
        nodeId: nodeById.has(edge.source) ? edge.source : null,
        message: "Conexão aponta para um nó inexistente.",
      });
    }
    const slot = `${edge.source}:${edge.sourceHandle ?? "out"}`;
    if (edgeSlots.has(slot)) {
      issues.push({
        nodeId: edge.source,
        message: "Mais de uma conexão usa a mesma saída — o caminho seria ambíguo.",
      });
    }
    edgeSlots.add(slot);
  }

  for (const node of nodes) {
    // Gramática do payload fl:<flow>:<nodeId>:<handle>: ":" quebraria o parse
    // e "start" é reservado (gate de DM pede reexecução do início).
    if (node.id.includes(":") || node.id === "start") {
      issues.push({
        nodeId: node.id,
        message: `Id de nó inválido ("${node.id}") — não pode conter ":" nem ser "start".`,
      });
    }
    if (node.type === "privateReply") {
      if (triggerType !== "comment") {
        issues.push({
          nodeId: node.id,
          message: "Resposta privada só funciona com gatilho de comentário.",
        });
      }
      const data = node.data as PrivateReplyNodeData;
      if (!data.text?.trim()) {
        issues.push({ nodeId: node.id, message: "Resposta privada sem texto." });
      }
    }
    if (node.type === "message") {
      const data = node.data as MessageNodeData;
      if (!data.text?.trim()) {
        issues.push({ nodeId: node.id, message: "Mensagem sem texto." });
      }
      if ((data.quickReplies ?? []).length > MAX_QUICK_REPLIES) {
        issues.push({
          nodeId: node.id,
          message: `Máximo de ${MAX_QUICK_REPLIES} quick replies por mensagem.`,
        });
      }
      if ((data.buttons ?? []).length > MAX_BUTTONS) {
        issues.push({
          nodeId: node.id,
          message: `Máximo de ${MAX_BUTTONS} botões por mensagem.`,
        });
      }
      const interactionIds = new Set<string>();
      for (const b of data.buttons ?? []) {
        if (b.type !== "web_url" && b.type !== "postback") {
          issues.push({ nodeId: node.id, message: "Tipo de botão inválido." });
          continue;
        }
        if (!b.title?.trim()) {
          issues.push({ nodeId: node.id, message: "Botão sem título." });
        } else if (b.title.length > 20) {
          issues.push({ nodeId: node.id, message: `Botão "${b.title}" excede 20 caracteres.` });
        }
        if (b.type === "web_url") {
          try {
            const url = new URL(b.url ?? "");
            if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
          } catch {
            issues.push({
              nodeId: node.id,
              message: `Botão "${b.title || "?"}" precisa de URL http(s) válida.`,
            });
          }
        } else if (b.id) {
          if (interactionIds.has(b.id)) {
            issues.push({ nodeId: node.id, message: "Opções de interação têm id duplicado." });
          }
          interactionIds.add(b.id);
        }
      }
      for (const q of data.quickReplies ?? []) {
        if (!q.title?.trim()) {
          issues.push({ nodeId: node.id, message: "Quick reply sem título." });
        } else if (q.title.length > 20) {
          issues.push({
            nodeId: node.id,
            message: `Quick reply "${q.title}" excede 20 caracteres.`,
          });
        }
        if (q.id) {
          if (interactionIds.has(q.id)) {
            issues.push({ nodeId: node.id, message: "Opções de interação têm id duplicado." });
          }
          interactionIds.add(q.id);
        }
      }
      const runtimeHandles = new Set<string>();
      (data.quickReplies ?? []).forEach((q, index) =>
        runtimeHandles.add(q.id ? `qr-${q.id}` : `qr-${index}`),
      );
      (data.buttons ?? []).forEach((b, index) => {
        if (b.type === "postback") {
          runtimeHandles.add(b.id ? `btn-${b.id}` : `btn-${index}`);
        }
      });
      for (const edge of edges.filter((edge) => edge.source === node.id)) {
        const handle = edge.sourceHandle ?? "out";
        if (runtimeHandles.size > 0 && handle === "out") {
          issues.push({
            nodeId: node.id,
            message: "Mensagem com interações não executa uma saída linear (out).",
          });
        } else if (handle !== "out" && !runtimeHandles.has(handle)) {
          issues.push({
            nodeId: node.id,
            message: "Conexão usa uma opção que não existe mais nesta mensagem.",
          });
        }
      }
    }
    if (node.type === "condition") {
      const data = node.data as ConditionNodeData;
      if (!(data.keywords ?? []).some((k) => k.trim())) {
        issues.push({
          nodeId: node.id,
          message: "Condição sem palavras-chave.",
        });
      }
      // O runtime segue match/nomatch estritos — qualquer outra saída de
      // condition nunca executaria.
      for (const e of edges.filter((e) => e.source === node.id)) {
        if (e.sourceHandle !== "match" && e.sourceHandle !== "nomatch") {
          issues.push({
            nodeId: node.id,
            message: "Saída da condição sem handle match/nomatch — esse caminho nunca executaria.",
          });
        }
      }
    }
  }

  // Alcançabilidade a partir do trigger + orçamento de envios consecutivos.
  const trigger = triggers[0];
  if (trigger) {
    const reachable = new Set<string>([trigger.id]);
    const queue = [trigger.id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of edges.filter((e) => e.source === cur)) {
        if (nodeById.has(e.target) && !reachable.has(e.target)) {
          reachable.add(e.target);
          queue.push(e.target);
        }
      }
    }
    for (const node of nodes) {
      if (!reachable.has(node.id)) {
        issues.push({
          nodeId: node.id,
          message: "Nó desconectado do gatilho — nunca será executado.",
        });
      }
    }

    const hasInteractions = (node: FlowNode): boolean => {
      if (node.type !== "message") return false;
      const data = node.data as MessageNodeData;
      return (
        (data.quickReplies ?? []).some((q) => q.title?.trim()) ||
        (data.buttons ?? []).some((b) => b.type === "postback" && b.title?.trim())
      );
    };

    // A cadeia inicial do gatilho (só saídas "out", antes de qualquer
    // interação): privateReply só executa aqui — em cliques/respostas não
    // existe contexto de comentário.
    const initialChain = new Set<string>();
    {
      let cur: FlowNode | undefined = trigger;
      while (cur && !initialChain.has(cur.id)) {
        initialChain.add(cur.id);
        if (cur.type === "condition" || hasInteractions(cur)) break;
        const next = outgoingEdge(edges, cur.id, "out");
        cur = next ? nodeById.get(next.target) : undefined;
      }
    }
    for (const node of nodes) {
      if (node.type === "privateReply" && reachable.has(node.id) && !initialChain.has(node.id)) {
        issues.push({
          nodeId: node.id,
          message:
            "Resposta privada só funciona logo após o gatilho de comentário — depois de um clique ou condição não existe mais o comentário pra responder.",
        });
      }
    }

    // Flow sem nenhum envio alcançável: ativo, ele captura os eventos (e
    // sombreia automações clássicas) sem fazer NADA.
    const hasSend = [...reachable].some((id) => {
      const n = nodeById.get(id);
      return n && (n.type === "privateReply" || n.type === "message");
    });
    if (!hasSend) {
      issues.push({
        nodeId: null,
        message:
          "O flow precisa de pelo menos uma mensagem — vazio, ele captura os eventos e não faz nada.",
      });
    }

    // Flow de comentário: a PRIMEIRA ação (não só o primeiro envio) precisa
    // ser a resposta privada — é ela que abre a conversa no Instagram; uma
    // condição na frente esperaria resposta numa conversa que não existe.
    if (triggerType === "comment") {
      const firstId = [...initialChain].find((id) => id !== trigger.id);
      const first = firstId ? nodeById.get(firstId) : undefined;
      if (first && first.type !== "privateReply") {
        issues.push({
          nodeId: first.id,
          message:
            "Num gatilho de comentário, a primeira ação deve ser uma Resposta privada — é ela que abre a conversa no Instagram.",
        });
      }
    }

    // Cadeia de envios sem interação: percorre saídas "out" contando envios.
    // (Cliques e condition zeram o contador — o próximo evento reinicia o
    // orçamento.) Mensagem COM interações também para: o runtime espera o
    // clique, o "out" dela não é seguido. Detecta também ciclo por "out".
    const countSends = (startId: string, budgetStart: number): void => {
      let count = budgetStart;
      let cur: FlowNode | undefined = nodeById.get(startId);
      const seen = new Set<string>();
      while (cur) {
        if (seen.has(cur.id)) {
          issues.push({
            nodeId: cur.id,
            message: "Ciclo de mensagens sem interação — o flow nunca pararia.",
          });
          return;
        }
        seen.add(cur.id);
        if (cur.type === "privateReply" || cur.type === "message") {
          count += 1;
          if (count > MAX_SENDS_PER_EVENT) {
            issues.push({
              nodeId: cur.id,
              message: `Mais de ${MAX_SENDS_PER_EVENT} envios seguidos sem interação — o webhook não tem tempo pra isso. Adicione botões/quick replies ou uma condição no caminho.`,
            });
            return;
          }
        }
        if (cur.type === "condition") return; // espera resposta: zera o orçamento
        if (hasInteractions(cur)) return; // espera clique: idem
        const next = outgoingEdge(edges, cur.id, "out");
        cur = next ? nodeById.get(next.target) : undefined;
      }
    };
    countSends(trigger.id, 0);
    // Cada clique/resultado de condição reinicia o orçamento no alvo da aresta.
    for (const e of edges) {
      if ((e.sourceHandle ?? "out") !== "out") countSends(e.target, 0);
    }
  }

  return issues;
}
