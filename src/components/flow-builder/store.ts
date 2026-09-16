// Store do builder (zustand): a árvore é a fonte de verdade; o canvas deriva
// dela. Toda mutação passa pelas operações puras de flow-tree.ts e empurra
// snapshot de undo (até 30). `dirty` liga o aviso de "alterações não salvas".
import { create } from "zustand";
import {
  addStep,
  createEmptyTree,
  deleteStep,
  updateStepConfig,
  type FlowTree,
  type Slot,
  type StepConfig,
  type TreeStepType,
} from "@/lib/flow-tree";

export interface FlowMeta {
  name: string;
  trigger_type: "comment" | "dm";
  instagram_post_id: string;
  instagram_post_type: string;
  keyword_filter_enabled: boolean;
  keywords: string; // separadas por vírgula (formato do input)
  require_follow: boolean;
  follower_gate_message: string;
  is_active: boolean;
}

export const TRIGGER_SELECTION_ID = "trigger";

interface PickerState {
  slot: Slot;
  x: number;
  y: number;
}

interface Snapshot {
  tree: FlowTree;
  meta: FlowMeta;
}

interface BuilderState {
  tree: FlowTree;
  meta: FlowMeta;
  selectedId: string | null;
  picker: PickerState | null;
  past: Snapshot[];
  dirty: boolean;

  load: (tree: FlowTree, meta: FlowMeta) => void;
  select: (id: string | null) => void;
  openPicker: (slot: Slot, pos: { x: number; y: number }) => void;
  closePicker: () => void;
  insertStep: (type: TreeStepType) => void;
  removeStep: (id: string) => void;
  patchStepConfig: (id: string, config: StepConfig) => void;
  /** Sem undo — digitação ao vivo do toolbar (nome, is_active). */
  patchMeta: (patch: Partial<FlowMeta>) => void;
  /** Com snapshot de undo — saves de painel (gatilho). */
  patchMetaTracked: (patch: Partial<FlowMeta>) => void;
  undo: () => void;
  markSaved: () => void;
}

const MAX_PAST = 30;

function pushPast(past: Snapshot[], snap: Snapshot): Snapshot[] {
  return [...past.slice(-(MAX_PAST - 1)), snap];
}

export const defaultMeta: FlowMeta = {
  name: "Novo flow",
  trigger_type: "comment",
  instagram_post_id: "*",
  instagram_post_type: "post",
  keyword_filter_enabled: false,
  keywords: "",
  require_follow: false,
  follower_gate_message: "",
  is_active: false,
};

export const useFlowBuilderStore = create<BuilderState>((set, get) => ({
  tree: createEmptyTree(),
  meta: defaultMeta,
  selectedId: null,
  picker: null,
  past: [],
  dirty: false,

  load: (tree, meta) => set({ tree, meta, selectedId: null, picker: null, past: [], dirty: false }),

  select: (id) => set({ selectedId: id, picker: null }),

  openPicker: (slot, pos) => set({ picker: { slot, ...pos }, selectedId: null }),

  closePicker: () => set({ picker: null }),

  insertStep: (type) => {
    const { tree, meta, picker, past } = get();
    if (!picker) return;
    const next = addStep(tree, picker.slot, type);
    if (next === tree) {
      set({ picker: null });
      return;
    }
    // Abre a config do step recém-criado (o novo id é o que não existia antes).
    const before = new Set<string>();
    collectIds(tree, before);
    let createdId: string | null = null;
    collectIds(next, undefined, (id) => {
      if (!before.has(id)) createdId = id;
    });
    set({
      tree: next,
      past: pushPast(past, { tree, meta }),
      picker: null,
      selectedId: createdId,
      dirty: true,
    });
  },

  removeStep: (id) => {
    const { tree, meta, past, selectedId } = get();
    const next = deleteStep(tree, id);
    if (next === tree) return;
    set({
      tree: next,
      past: pushPast(past, { tree, meta }),
      selectedId: selectedId === id ? null : selectedId,
      dirty: true,
    });
  },

  patchStepConfig: (id, config) => {
    const { tree, meta, past } = get();
    const next = updateStepConfig(tree, id, config);
    if (next === tree) return;
    set({ tree: next, past: pushPast(past, { tree, meta }), dirty: true });
  },

  patchMeta: (patch) => set((s) => ({ meta: { ...s.meta, ...patch }, dirty: true })),

  patchMetaTracked: (patch) => {
    const { tree, meta, past } = get();
    set({
      meta: { ...meta, ...patch },
      past: pushPast(past, { tree, meta }),
      dirty: true,
    });
  },

  undo: () => {
    const { past } = get();
    if (past.length === 0) return;
    const snap = past[past.length - 1];
    set({ tree: snap.tree, meta: snap.meta, past: past.slice(0, -1), dirty: true });
  },

  markSaved: () => set({ dirty: false }),
}));

function collectIds(tree: FlowTree, into?: Set<string>, visit?: (id: string) => void): void {
  const stack = [tree.root];
  while (stack.length) {
    const s = stack.pop();
    if (!s) continue;
    into?.add(s.id);
    visit?.(s.id);
    stack.push(s.next);
    for (const b of s.branches ?? []) stack.push(b.child);
  }
}
