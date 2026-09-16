// Árvore canônica de EDIÇÃO do flow builder (padrão Dispara): o usuário edita
// esta árvore; o canvas React Flow é 100% DERIVADO dela (layoutTree) e o motor
// do webhook consome o grafo COMPILADO dela (compileTree → flow-model).
//
// Invariantes:
// - message com quick replies/botões postback ramifica por branches (kind
//   "qr"/"btn") e não usa next; sem interações, encadeia por next.
// - Cada quick reply/botão postback do config carrega um `id` ESTÁVEL e a
//   branch correspondente usa ESSE MESMO id — a sincronização é por
//   identidade, nunca por posição (posição misroteava a subárvore do vizinho
//   ao remover/retipar uma opção do meio). O id também vira o handle do
//   clique no grafo compilado (qr-<id>/btn-<id>).
// - condition tem exatamente 2 branches fixas: match/nomatch.
// - privateReply só encadeia por next.
// - Ids de step vêm de crypto.randomUUID() — NUNCA "start" (reservado pro
//   gate de DM no webhook) nem "trigger-node" (nó sintetizado no compile).
import {
  MAX_BUTTONS,
  MAX_QUICK_REPLIES,
  type FlowButton,
  type FlowEdge,
  type FlowNode,
  type FlowQuickReply,
} from "@/lib/flow-model";

export type TreeStepType = "privateReply" | "message" | "condition";

export type BranchKind = "qr" | "btn" | "match" | "nomatch";

export interface TreeBranch {
  id: string;
  label: string;
  kind: BranchKind;
  child: TreeStep | null;
}

export interface MessageConfig {
  text: string;
  quickReplies: FlowQuickReply[];
  buttons: FlowButton[];
}

export interface PrivateReplyConfig {
  text: string;
}

export interface ConditionConfig {
  keywords: string[];
}

export type StepConfig = MessageConfig | PrivateReplyConfig | ConditionConfig;

export interface TreeStep {
  id: string;
  type: TreeStepType;
  config: StepConfig;
  next: TreeStep | null;
  branches?: TreeBranch[];
}

export interface FlowTree {
  schemaVersion: 1;
  root: TreeStep | null;
}

export type Slot =
  | { kind: "root" }
  | { kind: "after"; stepId: string }
  | { kind: "branch"; stepId: string; branchId: string };

export const TRIGGER_NODE_ID = "trigger-node";

export function createEmptyTree(): FlowTree {
  return { schemaVersion: 1, root: null };
}

export function createStep(type: TreeStepType): TreeStep {
  const id = crypto.randomUUID();
  if (type === "privateReply") {
    return { id, type, config: { text: "" }, next: null };
  }
  if (type === "condition") {
    return {
      id,
      type,
      config: { keywords: [] },
      next: null,
      branches: [
        { id: crypto.randomUUID(), label: "Se contém", kind: "match", child: null },
        { id: crypto.randomUUID(), label: "Se não contém", kind: "nomatch", child: null },
      ],
    };
  }
  return {
    id,
    type: "message",
    config: { text: "", quickReplies: [], buttons: [] },
    next: null,
    branches: [],
  };
}

/** message com QRs ou botões postback ramifica; sem interações, encadeia. */
export function stepHasInteractions(step: TreeStep): boolean {
  if (step.type !== "message") return false;
  const cfg = step.config as MessageConfig;
  return (
    (cfg.quickReplies?.length ?? 0) > 0 || (cfg.buttons ?? []).some((b) => b.type === "postback")
  );
}

export function walkSteps(tree: FlowTree, visit: (step: TreeStep) => void): void {
  const stack: (TreeStep | null)[] = [tree.root];
  while (stack.length) {
    const step = stack.pop();
    if (!step) continue;
    visit(step);
    stack.push(step.next);
    for (const b of step.branches ?? []) stack.push(b.child);
  }
}

export function findStep(tree: FlowTree, id: string): TreeStep | null {
  let found: TreeStep | null = null;
  walkSteps(tree, (s) => {
    if (s.id === id) found = s;
  });
  return found;
}

function clone(tree: FlowTree): FlowTree {
  return structuredClone(tree);
}

export function addStep(tree: FlowTree, slot: Slot, type: TreeStepType): FlowTree {
  const next = clone(tree);
  const step = createStep(type);
  // Condition nunca encadeia por next (compile/layout só seguem as branches):
  // a cauda do slot ocupado vai pra branch "match" — senão ela viraria
  // subárvore órfã invisível pro canvas, pro compile E pra validação.
  const adoptTail = () => {
    if (step.type === "condition" && step.next) {
      const match = (step.branches ?? []).find((b) => b.kind === "match");
      if (match) {
        match.child = step.next;
        step.next = null;
      }
    }
  };
  if (slot.kind === "root") {
    step.next = next.root;
    next.root = step;
    adoptTail();
    return next;
  }
  const target = findStep(next, slot.stepId);
  if (!target) return tree;
  if (slot.kind === "after") {
    step.next = target.next;
    target.next = step;
    adoptTail();
    return next;
  }
  const branch = (target.branches ?? []).find((b) => b.id === slot.branchId);
  if (!branch) return tree;
  step.next = branch.child;
  branch.child = step;
  adoptTail();
  return next;
}

/** Remove o step religando o pai ao next dele. Branches do removido são descartadas. */
export function deleteStep(tree: FlowTree, id: string): FlowTree {
  const next = clone(tree);
  if (next.root?.id === id) {
    next.root = next.root.next;
    return next;
  }
  let changed = false;
  walkSteps(next, (s) => {
    if (s.next?.id === id) {
      s.next = s.next.next;
      changed = true;
    }
    for (const b of s.branches ?? []) {
      if (b.child?.id === id) {
        b.child = b.child.next;
        changed = true;
      }
    }
  });
  return changed ? next : tree;
}

/**
 * Atualiza o config e SINCRONIZA branches com ele POR IDENTIDADE: cada quick
 * reply e cada botão postback carrega um `id` estável (gerado aqui se faltar)
 * e a branch correspondente usa o MESMO id. Remover/reordenar/retipar uma
 * opção afeta só a branch DELA — a subárvore das vizinhas fica intacta
 * (sincronizar por posição misroteava e apagava subárvores silenciosamente).
 * Condition mantém match/nomatch.
 */
export function updateStepConfig(tree: FlowTree, id: string, config: StepConfig): FlowTree {
  const next = clone(tree);
  const step = findStep(next, id);
  if (!step) return tree;
  step.config = structuredClone(config);

  if (step.type === "message") {
    const cfg = step.config as MessageConfig;
    cfg.quickReplies = (cfg.quickReplies ?? []).slice(0, MAX_QUICK_REPLIES);
    cfg.buttons = (cfg.buttons ?? []).slice(0, MAX_BUTTONS);
    const oldBranches = step.branches ?? [];
    const claimed = new Set<string>();

    // Backfill de id pra entries antigas sem id: adota positionalmente a
    // branch antiga do mesmo kind (uma única vez — daqui em diante o id cola).
    const backfill = (entries: { id?: string }[], kind: BranchKind) => {
      const olds = oldBranches.filter((b) => b.kind === kind);
      let cursor = 0;
      for (const e of entries) {
        if (e.id) continue;
        while (cursor < olds.length && claimed.has(olds[cursor].id)) cursor++;
        e.id = olds[cursor] ? olds[cursor].id : crypto.randomUUID();
        cursor++;
      }
    };
    // Entries COM id reivindicam a própria branch antes do backfill posicional.
    for (const q of cfg.quickReplies) if (q.id) claimed.add(q.id);
    for (const b of cfg.buttons) if (b.id) claimed.add(b.id);
    backfill(cfg.quickReplies, "qr");
    backfill(
      cfg.buttons.filter((b) => b.type === "postback"),
      "btn",
    );

    const branchFor = (entryId: string, label: string, kind: BranchKind): TreeBranch => {
      const existing = oldBranches.find((b) => b.id === entryId);
      return existing ? { ...existing, label, kind } : { id: entryId, label, kind, child: null };
    };
    const qrBranches = cfg.quickReplies.map((q, i) =>
      branchFor(q.id!, q.title || `Opção ${i + 1}`, "qr"),
    );
    const btnBranches = cfg.buttons
      .filter((b) => b.type === "postback")
      .map((b, i) => branchFor(b.id!, b.title || `Botão ${i + 1}`, "btn"));
    step.branches = [...qrBranches, ...btnBranches];
    // Com interações, o step ramifica — a cauda por next deixaria caminho
    // inalcançável; ela é movida pra primeira branch vazia (não se perde).
    if (stepHasInteractions(step) && step.next) {
      const empty = step.branches.find((b) => !b.child);
      if (empty) empty.child = step.next;
      step.next = null;
    }
  }

  return next;
}

// ── COMPILE: árvore → grafo executável (formato flow-model) ────────────────

export function compileTree(tree: FlowTree): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [
    { id: TRIGGER_NODE_ID, type: "trigger", position: { x: 0, y: 0 }, data: {} },
  ];
  const edges: FlowEdge[] = [];

  const pushEdge = (source: string, handle: string, target: string) => {
    edges.push({ id: `e-${source}-${handle}-${target}`, source, sourceHandle: handle, target });
  };

  const compileStep = (step: TreeStep): void => {
    if (step.type === "message") {
      const cfg = step.config as MessageConfig;
      const qrBranches = (step.branches ?? []).filter((b) => b.kind === "qr");
      const btnBranches = (step.branches ?? []).filter((b) => b.kind === "btn");
      let legacyButtonBranchIndex = 0;
      // Handle do clique = id ESTÁVEL da opção (qr-<id>/btn-<id>), o MESMO id
      // da branch (sincronizados por identidade no updateStepConfig): o motor
      // monta o payload com o id vindo do data — imune a reordenação/remoção
      // de botões em edições futuras. O fallback posicional só hidrata árvores
      // legadas, nas quais a branch já tinha UUID mas a opção ainda não tinha id.
      nodes.push({
        id: step.id,
        type: "message",
        position: { x: 0, y: 0 },
        data: {
          text: cfg.text ?? "",
          quickReplies: (cfg.quickReplies ?? []).map((q, index) => ({
            title: q.title,
            id: q.id ?? qrBranches[index]?.id,
          })),
          buttons: (cfg.buttons ?? []).map((b) => {
            if (b.type !== "postback") return { ...b };
            const legacyBranch = btnBranches[legacyButtonBranchIndex++];
            return { ...b, id: b.id ?? legacyBranch?.id };
          }),
        },
      });
      for (const b of step.branches ?? []) {
        if (b.child && (b.kind === "qr" || b.kind === "btn")) {
          pushEdge(step.id, `${b.kind}-${b.id}`, b.child.id);
          compileStep(b.child);
        }
      }
      if (step.next) {
        pushEdge(step.id, "out", step.next.id);
        compileStep(step.next);
      }
      return;
    }

    if (step.type === "condition") {
      const cfg = step.config as ConditionConfig;
      nodes.push({
        id: step.id,
        type: "condition",
        position: { x: 0, y: 0 },
        data: { keywords: cfg.keywords ?? [] },
      });
      for (const b of step.branches ?? []) {
        if (b.child) {
          pushEdge(step.id, b.kind, b.child.id);
          compileStep(b.child);
        }
      }
      return;
    }

    const cfg = step.config as PrivateReplyConfig;
    nodes.push({
      id: step.id,
      type: "privateReply",
      position: { x: 0, y: 0 },
      data: { text: cfg.text ?? "" },
    });
    if (step.next) {
      pushEdge(step.id, "out", step.next.id);
      compileStep(step.next);
    }
  };

  if (tree.root) {
    pushEdge(TRIGGER_NODE_ID, "out", tree.root.id);
    compileStep(tree.root);
  }

  return { nodes, edges };
}

// ── LAYOUT: árvore → nodes/edges VISUAIS pro React Flow ────────────────────

export const NODE_W = 300;
const NODE_H = 76;
const TRIGGER_H = 84;
const LEAF_H = 40;
const V_GAP = 56;
const H_GAP = 40;

export interface VisualNodeData {
  step?: TreeStep;
  slot?: Slot;
  triggerMeta?: LayoutTriggerMeta;
  [key: string]: unknown;
}

export interface VisualEdgeData {
  slot?: Slot;
  branchLabel?: string;
  [key: string]: unknown;
}

export interface VisualNode {
  id: string;
  type: "trigger" | "step" | "placeholder" | "plus";
  position: { x: number; y: number };
  data: VisualNodeData;
  selected?: boolean;
  draggable?: boolean;
}

export interface VisualEdge {
  id: string;
  source: string;
  target: string;
  type: "flow";
  data: VisualEdgeData;
}

export interface LayoutTriggerMeta {
  trigger_type: string;
  instagram_post_id: string;
  keyword_filter_enabled: boolean;
  keywords: string[];
}

interface Layouted {
  nodes: VisualNode[];
  edges: VisualEdge[];
  width: number;
  height: number;
}

/** Mede e posiciona a sub-árvore com origem no topo-centro (cx, y). */
function layoutChain(
  step: TreeStep | null,
  cx: number,
  y: number,
  leafSlot: Slot,
  leafIdPrefix: string,
): Layouted {
  if (!step) {
    // Cadeia aberta: folha "+" convida a adicionar.
    return {
      nodes: [
        {
          id: `plus-${leafIdPrefix}`,
          type: "plus",
          position: { x: cx - 20, y },
          data: { slot: leafSlot },
        },
      ],
      edges: [],
      width: NODE_W,
      height: LEAF_H,
    };
  }

  const nodes: VisualNode[] = [];
  const edges: VisualEdge[] = [];

  const branches = step.branches ?? [];
  const ramifies = branches.length > 0 && (step.type === "condition" || stepHasInteractions(step));

  if (ramifies) {
    // Mede cada branch primeiro pra centralizar o pai sobre o conjunto.
    const childLayouts = branches.map((b, i) =>
      layoutChain(
        b.child,
        0,
        0,
        { kind: "branch", stepId: step.id, branchId: b.id },
        `${step.id}-b${i}`,
      ),
    );
    const totalWidth =
      childLayouts.reduce((acc, l) => acc + l.width, 0) + H_GAP * (branches.length - 1);
    const width = Math.max(NODE_W, totalWidth);

    nodes.push({
      id: step.id,
      type: "step",
      position: { x: cx - NODE_W / 2, y },
      data: { step },
    });

    let childX = cx - totalWidth / 2;
    let maxChildHeight = 0;
    const childY = y + NODE_H + V_GAP;
    branches.forEach((b, i) => {
      const l = childLayouts[i];
      const branchCx = childX + l.width / 2;
      const placed = layoutChain(
        b.child,
        branchCx,
        childY,
        { kind: "branch", stepId: step.id, branchId: b.id },
        `${step.id}-b${i}`,
      );
      nodes.push(...placed.nodes);
      edges.push(...placed.edges);
      const targetId = b.child ? b.child.id : `plus-${step.id}-b${i}`;
      edges.push({
        id: `ve-${step.id}-${b.id}`,
        source: step.id,
        target: targetId,
        type: "flow",
        data: {
          branchLabel: b.label,
          slot: b.child ? { kind: "branch", stepId: step.id, branchId: b.id } : undefined,
        },
      });
      childX += l.width + H_GAP;
      maxChildHeight = Math.max(maxChildHeight, placed.height);
    });

    return { nodes, edges, width, height: NODE_H + V_GAP + maxChildHeight };
  }

  // Cadeia linear: step + next abaixo.
  nodes.push({
    id: step.id,
    type: "step",
    position: { x: cx - NODE_W / 2, y },
    data: { step },
  });
  const below = layoutChain(
    step.next,
    cx,
    y + NODE_H + V_GAP,
    { kind: "after", stepId: step.id },
    step.id,
  );
  nodes.push(...below.nodes);
  edges.push(...below.edges);
  const targetId = step.next ? step.next.id : `plus-${step.id}`;
  edges.push({
    id: `ve-${step.id}-next`,
    source: step.id,
    target: targetId,
    type: "flow",
    data: { slot: step.next ? { kind: "after", stepId: step.id } : undefined },
  });

  return {
    nodes,
    edges,
    width: Math.max(NODE_W, below.width),
    height: NODE_H + V_GAP + below.height,
  };
}

export function layoutTree(
  tree: FlowTree,
  triggerMeta: LayoutTriggerMeta,
): { nodes: VisualNode[]; edges: VisualEdge[] } {
  const nodes: VisualNode[] = [
    {
      id: TRIGGER_NODE_ID,
      type: "trigger",
      position: { x: -NODE_W / 2, y: 0 },
      data: { triggerMeta },
    },
  ];
  const edges: VisualEdge[] = [];

  const rootY = TRIGGER_H + V_GAP;
  if (tree.root) {
    const placed = layoutChain(tree.root, 0, rootY, { kind: "root" }, "root");
    nodes.push(...placed.nodes);
    edges.push(...placed.edges);
    edges.push({
      id: "ve-trigger-root",
      source: TRIGGER_NODE_ID,
      target: tree.root.id,
      type: "flow",
      data: { slot: { kind: "root" } },
    });
  } else {
    nodes.push({
      id: "placeholder-root",
      type: "placeholder",
      position: { x: -NODE_W / 2, y: rootY },
      data: { slot: { kind: "root" } },
    });
    edges.push({
      id: "ve-trigger-placeholder",
      source: TRIGGER_NODE_ID,
      target: "placeholder-root",
      type: "flow",
      data: {},
    });
  }

  return { nodes, edges };
}

/** Resumo de 1 linha do step pro card do canvas. */
export function stepSummary(step: TreeStep): string {
  if (step.type === "privateReply") {
    const t = (step.config as PrivateReplyConfig).text;
    return t ? t.slice(0, 60) : "Sem texto";
  }
  if (step.type === "condition") {
    const kws = (step.config as ConditionConfig).keywords.filter(Boolean);
    return kws.length ? `Contém: ${kws.slice(0, 3).join(", ")}` : "Sem palavras-chave";
  }
  const cfg = step.config as MessageConfig;
  const parts: string[] = [];
  if (cfg.text) parts.push(cfg.text.slice(0, 40));
  const n = (cfg.quickReplies?.length ?? 0) + (cfg.buttons?.length ?? 0);
  if (n > 0) parts.push(`${n} botão(ões)`);
  return parts.join(" · ") || "Sem texto";
}

export const STEP_META: Record<TreeStepType, { label: string; description: string }> = {
  privateReply: {
    label: "Resposta privada",
    description: "DM privada respondendo o comentário (abre a conversa).",
  },
  message: {
    label: "Mensagem",
    description: "Mensagem na conversa, com quick replies e botões opcionais.",
  },
  condition: {
    label: "Condição",
    description: "Espera a resposta e ramifica por palavras-chave.",
  },
};

/** Hidrata uma tree persistida (jsonb) com fallback seguro. */
const TREE_STEP_TYPES: readonly string[] = ["privateReply", "message", "condition"];
const BRANCH_KINDS: readonly string[] = ["qr", "btn", "match", "nomatch"];

function isValidStep(raw: unknown): boolean {
  if (raw === null) return true;
  if (!raw || typeof raw !== "object") return false;
  const s = raw as Partial<TreeStep>;
  if (typeof s.id !== "string" || !s.id) return false;
  if (!TREE_STEP_TYPES.includes(s.type as string)) return false;
  if (!s.config || typeof s.config !== "object") return false;
  if (s.branches !== undefined) {
    if (!Array.isArray(s.branches)) return false;
    for (const b of s.branches) {
      if (!b || typeof b !== "object") return false;
      if (typeof b.id !== "string" || !BRANCH_KINDS.includes(b.kind)) return false;
      if (!isValidStep(b.child)) return false;
    }
  }
  return isValidStep(s.next ?? null);
}

/** Hidratação defensiva: árvore malformada (banco editado à mão, versão
 * futura, bug de escrita) cai pro flow vazio em vez de derrubar o editor. */
export function parseTree(raw: unknown): FlowTree {
  if (
    raw &&
    typeof raw === "object" &&
    (raw as { schemaVersion?: number }).schemaVersion === 1 &&
    "root" in (raw as object) &&
    isValidStep((raw as { root: unknown }).root)
  ) {
    return raw as FlowTree;
  }
  return createEmptyTree();
}
