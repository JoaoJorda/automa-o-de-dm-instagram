import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Loader2, MessageCircle, Pencil, Plus, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { createFlow, deleteFlow, listFlows, toggleFlow } from "@/functions/flows.functions";
import { createEmptyTree } from "@/lib/flow-tree";

export const Route = createFileRoute("/_dashboard/flows")({
  component: FlowsPage,
});

function FlowsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["flows"],
    queryFn: () => listFlows(),
  });

  const createM = useMutation({
    mutationFn: () =>
      createFlow({
        data: {
          name: "Novo flow",
          trigger_type: "comment",
          instagram_post_id: "*",
          tree: createEmptyTree(),
          nodes: [],
          edges: [],
          is_active: false,
        },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["flows"] });
      navigate({ to: "/flows/$id/edit", params: { id: r.flow.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleM = useMutation({
    mutationFn: (vars: { id: string; is_active: boolean }) => toggleFlow({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["flows"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => deleteFlow({ data: { id } }),
    onSuccess: () => {
      toast.success("Flow removido");
      qc.invalidateQueries({ queryKey: ["flows"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const flows = data?.flows ?? [];
  const activeCount = flows.filter((f) => f.is_active).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Flows</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automações em fluxo visual · {flows.length} flow(s) · {activeCount} ativo(s)
          </p>
        </div>
        <Button size="sm" onClick={() => createM.mutate()} disabled={createM.isPending}>
          {createM.isPending ? (
            <Loader2 className="size-4 mr-1 animate-spin" />
          ) : (
            <Plus className="size-4 mr-1" />
          )}
          Novo flow
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && !data && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Não foi possível carregar os flows: {error.message}
        </div>
      )}

      {!isLoading && data && flows.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <Workflow className="size-12 text-muted-foreground/30" />
          <div>
            <p className="font-medium">Nenhum flow criado</p>
            <p className="text-sm text-muted-foreground mt-1">
              Monte fluxos com mensagens encadeadas, botões e condições — além do que a automação
              simples faz.
            </p>
          </div>
          <Button onClick={() => createM.mutate()} disabled={createM.isPending}>
            <Plus className="size-4 mr-1" />
            Criar meu primeiro flow
          </Button>
        </div>
      )}

      {!isLoading && flows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {flows.map((flow) => (
            <Card key={flow.id} className="group">
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    to="/flows/$id/edit"
                    params={{ id: flow.id }}
                    className="min-w-0 text-sm font-medium truncate hover:underline"
                  >
                    {flow.name}
                  </Link>
                  <Switch
                    checked={flow.is_active}
                    onCheckedChange={(v) => toggleM.mutate({ id: flow.id, is_active: v })}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px]">
                    {flow.trigger_type === "dm" ? (
                      <>
                        <MessageCircle className="size-3 mr-1" />
                        DM
                      </>
                    ) : (
                      <>
                        <GitBranch className="size-3 mr-1" />
                        Comentário
                      </>
                    )}
                  </Badge>
                  <Badge
                    className={
                      flow.is_active
                        ? "bg-emerald-500 text-white text-[10px]"
                        : "bg-muted text-muted-foreground text-[10px]"
                    }
                  >
                    {flow.is_active ? "ATIVO" : "PAUSADO"}
                  </Badge>
                  {flow.trigger_type === "comment" && flow.instagram_post_id === "*" && (
                    <span className="text-[11px] text-muted-foreground">qualquer post</span>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {flow.total_sent ?? 0} enviada(s) · {flow.total_clicks ?? 0} clique(s)
                    {(flow.total_sent ?? 0) > 0 &&
                      ` · CTR ${(((flow.total_clicks ?? 0) / flow.total_sent) * 100).toFixed(0)}%`}
                  </span>
                  <div className="flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                    <Link to="/flows/$id/edit" params={{ id: flow.id }}>
                      <Button variant="ghost" size="icon" className="size-7">
                        <Pencil className="size-3.5" />
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Apagar o flow "${flow.name}"? Essa ação não tem volta.`)) {
                          deleteM.mutate(flow.id);
                        }
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
