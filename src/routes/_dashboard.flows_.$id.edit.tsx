import { useEffect, useMemo, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, Loader2, Save, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getFlow, updateFlow } from "@/functions/flows.functions";
import { validateFlow } from "@/lib/flow-model";
import { compileTree, parseTree } from "@/lib/flow-tree";
import { useFlowBuilderStore } from "@/components/flow-builder/store";
import { FlowCanvas } from "@/components/flow-builder/FlowCanvas";
import { ConfigPanel } from "@/components/flow-builder/ConfigPanel";
import { ActionPicker } from "@/components/flow-builder/ActionPicker";

export const Route = createFileRoute("/_dashboard/flows_/$id/edit")({
  component: FlowEditorPage,
});

function FlowEditorPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["flow", id],
    queryFn: () => getFlow({ data: { id } }),
  });

  const load = useFlowBuilderStore((s) => s.load);
  const tree = useFlowBuilderStore((s) => s.tree);
  const meta = useFlowBuilderStore((s) => s.meta);
  const dirty = useFlowBuilderStore((s) => s.dirty);
  const past = useFlowBuilderStore((s) => s.past);
  const undo = useFlowBuilderStore((s) => s.undo);
  const patchMeta = useFlowBuilderStore((s) => s.patchMeta);

  // Hidrata o store UMA vez por flow: o refetch pós-save não pode re-hidratar
  // (apagaria undo/seleção e qualquer edit feito na janela do refetch).
  const hydratedId = useRef<string | null>(null);
  useEffect(() => {
    if (!data?.flow || hydratedId.current === id) return;
    hydratedId.current = id;
    const f = data.flow;
    load(parseTree(f.tree), {
      name: f.name,
      trigger_type: f.trigger_type === "dm" ? "dm" : "comment",
      instagram_post_id: f.instagram_post_id ?? "*",
      instagram_post_type: f.instagram_post_type ?? "post",
      keyword_filter_enabled: f.keyword_filter_enabled,
      keywords: (f.keywords ?? []).join(", "),
      require_follow: f.require_follow,
      follower_gate_message: f.follower_gate_message ?? "",
      is_active: f.is_active,
    });
  }, [data, id, load]);

  const issues = useMemo(() => {
    const { nodes, edges } = compileTree(tree);
    return validateFlow(nodes, edges, meta.trigger_type);
  }, [tree, meta.trigger_type]);

  // Guarda árvore E metadados exatos que foram pro banco: edições feitas
  // DURANTE o save em voo não podem ser marcadas como salvas.
  const savedSnapshotRef = useRef<{ tree: typeof tree; meta: typeof meta } | null>(null);

  const saveM = useMutation({
    mutationFn: (activate?: boolean) => {
      const { tree: freshTree, meta: freshMeta } = useFlowBuilderStore.getState();
      savedSnapshotRef.current = { tree: freshTree, meta: freshMeta };
      const { nodes, edges } = compileTree(freshTree);
      const is_active = activate ?? freshMeta.is_active;
      return updateFlow({
        data: {
          id,
          name: freshMeta.name.trim() || "Sem nome",
          trigger_type: freshMeta.trigger_type,
          instagram_post_id: freshMeta.instagram_post_id,
          instagram_post_type: freshMeta.instagram_post_type,
          keyword_filter_enabled: freshMeta.keyword_filter_enabled,
          keywords: freshMeta.keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
          require_follow: freshMeta.require_follow,
          follower_gate_message: freshMeta.follower_gate_message,
          tree: freshTree,
          nodes,
          edges,
          is_active,
        },
      });
    },
    onSuccess: (r) => {
      const current = useFlowBuilderStore.getState();
      const sent = savedSnapshotRef.current;
      const unchanged = !!sent && current.tree === sent.tree && current.meta === sent.meta;
      // Atualiza o estado persistido sem marcar dirty por si só. Se nome,
      // gatilho ou árvore mudaram durante o request, preserva o aviso.
      useFlowBuilderStore.setState((state) => ({
        meta: { ...state.meta, is_active: r.flow.is_active },
        dirty: unchanged ? false : state.dirty,
      }));
      qc.invalidateQueries({ queryKey: ["flows"] });
      qc.invalidateQueries({ queryKey: ["flow", id] });
      toast.success(r.flow.is_active ? "Flow salvo e ativo!" : "Flow salvo.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Alterações não salvas: avisa antes de refresh/fechar aba.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <p className="text-sm text-destructive">{error?.message || "Flow não encontrado"}</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-9.5rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/flows"
          onClick={(e) => {
            if (dirty && !confirm("Você tem alterações não salvas. Sair mesmo assim?")) {
              e.preventDefault();
            }
          }}
        >
          <Button variant="ghost" size="icon" className="size-8">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <Input
          value={meta.name}
          onChange={(e) => patchMeta({ name: e.target.value })}
          maxLength={200}
          className="h-9 w-56 font-medium"
        />

        {issues.length === 0 ? (
          <Badge variant="outline" className="gap-1 text-emerald-500 border-emerald-500/40">
            <Check className="size-3" />
            Válido
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="gap-1 text-amber-500 border-amber-500/40"
            title={issues.map((i) => i.message).join("\n")}
          >
            <AlertTriangle className="size-3" />
            {issues.length} problema(s)
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={past.length === 0}
            onClick={undo}
          >
            <Undo2 className="size-4" />
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Ativo</span>
            <Switch
              checked={meta.is_active}
              disabled={saveM.isPending}
              onCheckedChange={(v) => {
                if (v && issues.length > 0) {
                  toast.error(
                    `Corrija antes de ativar: ${issues[0].message}${issues.length > 1 ? ` (+${issues.length - 1})` : ""}`,
                  );
                  return;
                }
                saveM.mutate(v);
              }}
            />
          </div>
          <Button size="sm" onClick={() => saveM.mutate(undefined)} disabled={saveM.isPending}>
            {saveM.isPending ? (
              <Loader2 className="size-4 mr-1 animate-spin" />
            ) : (
              <Save className="size-4 mr-1" />
            )}
            Salvar{dirty ? " *" : ""}
          </Button>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          {issues
            .slice(0, 3)
            .map((i) => i.message)
            .join(" · ")}
          {issues.length > 3 && ` · +${issues.length - 3}`}
        </div>
      )}

      <div className="relative flex-1 overflow-hidden rounded-xl border border-border bg-card/40">
        <FlowCanvas />
        <ConfigPanel />
      </div>

      <ActionPicker />
    </div>
  );
}
