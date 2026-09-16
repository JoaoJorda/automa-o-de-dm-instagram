// Edge visual: smoothstep com pílula de label (branches) e botão "+" pra
// inserir um passo no meio do caminho (padrão Dispara).
import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
  type EdgeTypes,
} from "@xyflow/react";
import { Plus } from "lucide-react";
import type { Slot } from "@/lib/flow-tree";
import { useFlowBuilderStore } from "./store";

const FlowEdgeComponent = memo(function FlowEdgeComponent({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
}: EdgeProps) {
  const openPicker = useFlowBuilderStore((s) => s.openPicker);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });
  const slot = (data as { slot?: Slot } | undefined)?.slot;
  const branchLabel = (data as { branchLabel?: string } | undefined)?.branchLabel;

  return (
    <>
      {/* Tokens do tema são cores oklch completas — hsl(var(--border)) seria inválido. */}
      <BaseEdge path={path} style={{ stroke: "var(--border)", strokeWidth: 1.5 }} />
      <EdgeLabelRenderer>
        <div
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          className="pointer-events-auto absolute flex items-center gap-1"
        >
          {branchLabel && (
            <span className="max-w-[140px] truncate rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
              {branchLabel}
            </span>
          )}
          {slot && (
            <button
              onClick={(e) => openPicker(slot, { x: e.clientX, y: e.clientY })}
              className="flex size-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              title="Inserir passo aqui"
            >
              <Plus className="size-3" />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

export const edgeTypes: EdgeTypes = {
  flow: FlowEdgeComponent,
};
