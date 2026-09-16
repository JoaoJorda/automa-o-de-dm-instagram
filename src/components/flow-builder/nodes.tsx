// Nós visuais do canvas (derivados da árvore — read-only, sem drag/connect).
import { memo } from "react";
import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react";
import { GitBranch, MessageCircle, MessageSquareReply, Plus, Trash2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  stepSummary,
  STEP_META,
  type LayoutTriggerMeta,
  type Slot,
  type TreeStep,
} from "@/lib/flow-tree";
import { useFlowBuilderStore, TRIGGER_SELECTION_ID } from "./store";

const STEP_ICON = {
  privateReply: MessageSquareReply,
  message: MessageCircle,
  condition: GitBranch,
} as const;

const TriggerNode = memo(function TriggerNode({ data, selected }: NodeProps) {
  const meta = (data as { triggerMeta?: LayoutTriggerMeta }).triggerMeta;
  const select = useFlowBuilderStore((s) => s.select);
  const summary =
    meta?.trigger_type === "dm"
      ? `DM com: ${meta.keywords.slice(0, 3).join(", ") || "—"}`
      : meta?.instagram_post_id === "*"
        ? "Comentário em qualquer post"
        : `Comentário no post ${meta?.instagram_post_id?.slice(0, 18) ?? ""}…`;
  return (
    <button
      onClick={() => select(TRIGGER_SELECTION_ID)}
      className={cn(
        "w-[300px] rounded-xl border-2 border-dashed bg-card px-4 py-3 text-left transition-colors",
        selected
          ? "border-primary ring-2 ring-primary/30"
          : "border-primary/40 hover:border-primary/70",
      )}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15">
          <Zap className="size-4 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium">
            Gatilho · {meta?.trigger_type === "dm" ? "DM recebida" : "Comentário"}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {summary}
            {meta?.keyword_filter_enabled && meta.trigger_type === "comment"
              ? ` · keywords: ${meta.keywords.slice(0, 3).join(", ") || "—"}`
              : ""}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-primary/60" />
    </button>
  );
});

const StepNode = memo(function StepNode({ data, selected }: NodeProps) {
  const step = (data as { step?: TreeStep }).step;
  const select = useFlowBuilderStore((s) => s.select);
  const removeStep = useFlowBuilderStore((s) => s.removeStep);
  if (!step) return null;
  const Icon = STEP_ICON[step.type];
  return (
    <div
      onClick={() => select(step.id)}
      className={cn(
        "group w-[300px] cursor-pointer rounded-xl border bg-card px-4 py-3 shadow-sm transition-colors",
        selected
          ? "border-primary ring-2 ring-primary/30"
          : "border-border hover:border-primary/50",
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <div className="flex items-start gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="size-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{STEP_META[step.type].label}</div>
          <div className="truncate text-[11px] text-muted-foreground">{stepSummary(step)}</div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm("Apagar este passo? Ramificações dele serão perdidas.")) {
              removeStep(step.id);
            }
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  );
});

const PlaceholderNode = memo(function PlaceholderNode({ data }: NodeProps) {
  const slot = (data as { slot?: Slot }).slot;
  const openPicker = useFlowBuilderStore((s) => s.openPicker);
  return (
    <div className="w-[300px]">
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <button
        onClick={(e) => slot && openPicker(slot, { x: e.clientX, y: e.clientY })}
        className="w-full rounded-xl border-2 border-dashed border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
      >
        <Plus className="mr-1 inline size-3.5" />
        Adicionar ação
      </button>
    </div>
  );
});

const PlusLeafNode = memo(function PlusLeafNode({ data }: NodeProps) {
  const slot = (data as { slot?: Slot }).slot;
  const openPicker = useFlowBuilderStore((s) => s.openPicker);
  return (
    <div className="flex w-10 justify-center">
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <button
        onClick={(e) => slot && openPicker(slot, { x: e.clientX, y: e.clientY })}
        className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        title="Adicionar ação"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
});

export const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  step: StepNode,
  placeholder: PlaceholderNode,
  plus: PlusLeafNode,
};
