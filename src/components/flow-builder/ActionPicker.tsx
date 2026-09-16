// Popover de escolha de tipo de passo, aberto no ponto do clique dos "+".
import { useEffect, useRef } from "react";
import { GitBranch, MessageCircle, MessageSquareReply } from "lucide-react";
import { STEP_META, type TreeStepType } from "@/lib/flow-tree";
import { useFlowBuilderStore } from "./store";

const ICONS = {
  privateReply: MessageSquareReply,
  message: MessageCircle,
  condition: GitBranch,
} as const;

export function ActionPicker() {
  const picker = useFlowBuilderStore((s) => s.picker);
  const meta = useFlowBuilderStore((s) => s.meta);
  const insertStep = useFlowBuilderStore((s) => s.insertStep);
  const closePicker = useFlowBuilderStore((s) => s.closePicker);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!picker) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closePicker();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePicker();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [picker, closePicker]);

  if (!picker) return null;

  const types: TreeStepType[] =
    meta.trigger_type === "comment"
      ? ["privateReply", "message", "condition"]
      : ["message", "condition"];

  // Clampa pra não estourar a viewport.
  const left = Math.min(picker.x, window.innerWidth - 300);
  const top = Math.min(picker.y, window.innerHeight - types.length * 72 - 24);

  return (
    <div
      ref={ref}
      style={{ left, top }}
      className="fixed z-50 w-72 rounded-xl border border-border bg-popover p-1.5 shadow-lg"
    >
      <p className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Adicionar passo
      </p>
      {types.map((type) => {
        const Icon = ICONS[type];
        return (
          <button
            key={type}
            onClick={() => insertStep(type)}
            className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/60"
          >
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <Icon className="size-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{STEP_META[type].label}</div>
              <div className="text-[11px] leading-snug text-muted-foreground">
                {STEP_META[type].description}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
