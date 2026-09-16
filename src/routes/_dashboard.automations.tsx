import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Bot,
  MoreVertical,
  Pencil,
  Copy,
  Trash2,
  MessageCircle,
  Filter,
  TrendingUp,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listAutomations,
  toggleAutomation,
  deleteAutomation,
  createAutomation,
} from "@/functions/automations.functions";

export const Route = createFileRoute("/_dashboard/automations")({
  component: AutomationsPage,
});

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);
  if (diffMin < 60) return `há ${diffMin}min`;
  if (diffH < 24) return `há ${diffH}h`;
  if (diffD < 30) return `há ${diffD}d`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function AutomationsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["automations"],
    queryFn: () => listAutomations(),
  });

  const toggleM = useMutation({
    mutationFn: (vars: { id: string; is_active: boolean }) => toggleAutomation({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => deleteAutomation({ data: { id } }),
    onSuccess: () => {
      toast.success("Automação removida");
      qc.invalidateQueries({ queryKey: ["automations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const automations = data?.automations ?? [];

  const duplicateM = useMutation({
    mutationFn: (a: (typeof automations)[number]) =>
      // O create reescreve todos os payloads com o id novo (rewriteAll) —
      // a cópia nasce pausada e sem colisão com a original.
      createAutomation({
        data: {
          // slice: o sufixo não pode estourar o limite de 200 do validate.
          name: `${a.name.slice(0, 192)} (cópia)`,
          instagram_post_id: a.instagram_post_id,
          instagram_post_type: a.instagram_post_type,
          custom_message: a.custom_message ?? "",
          followup_message: a.followup_message ?? "",
          quick_replies: Array.isArray(a.quick_replies)
            ? (a.quick_replies as { title: string; payload: string }[])
            : [],
          buttons: Array.isArray(a.buttons)
            ? (a.buttons as { type: string; title: string; payload?: string; url?: string }[])
            : [],
          is_active: false,
          keyword_filter_enabled: a.keyword_filter_enabled,
          keywords: a.keywords ?? [],
          delay_min_seconds: a.delay_min_seconds,
          delay_max_seconds: a.delay_max_seconds,
          trigger_on_dm: a.trigger_on_dm ?? false,
          require_follow: a.require_follow ?? false,
          follower_gate_message: a.follower_gate_message ?? "",
        },
      }),
    onSuccess: () => {
      toast.success("Automação duplicada (pausada) — edite e ative quando quiser.");
      qc.invalidateQueries({ queryKey: ["automations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeCount = automations.filter((a) => a.is_active).length;

  // CTR de verdade: cliques em botões/quick replies ÷ DMs enviadas.
  function ctr(a: (typeof automations)[number]) {
    const sent = a.total_sent ?? 0;
    if (sent === 0) return "—";
    return `${(((a.total_clicks ?? 0) / sent) * 100).toFixed(1)}%`;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Automações</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {automations.length} automação(ões) · {activeCount} ativa(s)
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/templates">
            <Button variant="outline" size="sm">
              <Bot className="size-4 mr-1" />
              Templates
            </Button>
          </Link>
          <Link to="/automations/new">
            <Button size="sm">
              <Plus className="size-4 mr-1" />
              Nova Automação
            </Button>
          </Link>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && !data && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Não foi possível carregar as automações: {error.message}
        </div>
      )}

      {!isLoading && data && automations.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <Bot className="size-12 text-muted-foreground/30" />
          <div>
            <p className="font-medium">Nenhuma automação criada</p>
            <p className="text-sm text-muted-foreground mt-1">
              Comece importando um template ou crie do zero.
            </p>
          </div>
          <div className="flex gap-2">
            <Link to="/templates">
              <Button variant="outline">
                <Bot className="size-4 mr-1" />
                Ver Templates
              </Button>
            </Link>
            <Link to="/automations/new">
              <Button>
                <Plus className="size-4 mr-1" />
                Criar Automação
              </Button>
            </Link>
          </div>
        </div>
      )}

      {!isLoading && automations.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="hidden sm:grid sm:grid-cols-[1fr_80px_80px_100px_40px] gap-4 px-4 py-2.5 text-xs font-medium text-muted-foreground bg-muted/30 border-b border-border">
            <span>Nome</span>
            <span className="text-right">Enviadas</span>
            <span className="text-right" title="Cliques em botões ÷ DMs enviadas">
              CTR
            </span>
            <span className="text-right">Modificado</span>
            <span></span>
          </div>

          <div className="divide-y divide-border">
            {automations.map((auto) => {
              const qrCount = Array.isArray(auto.quick_replies) ? auto.quick_replies.length : 0;
              const btnCount = Array.isArray(auto.buttons) ? auto.buttons.length : 0;
              return (
                <div
                  key={auto.id}
                  className="group relative flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-muted/20 sm:grid sm:grid-cols-[1fr_80px_80px_100px_40px] sm:items-center sm:gap-4"
                >
                  {/* pr-10 no mobile: reserva a faixa do botão de ações (absolute right-2). */}
                  <div className="flex flex-col gap-1.5 min-w-0 pr-10 sm:pr-0">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleM.mutate({ id: auto.id, is_active: !auto.is_active })}
                        className="shrink-0"
                      >
                        {auto.is_active ? (
                          <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0 cursor-pointer">
                            ATIVA
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="text-[10px] font-bold px-1.5 py-0 cursor-pointer text-muted-foreground"
                          >
                            PAUSADA
                          </Badge>
                        )}
                      </button>
                      <Link
                        to="/automations/$id/edit"
                        params={{ id: auto.id }}
                        className="text-sm font-medium truncate hover:underline"
                      >
                        {auto.name}
                      </Link>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pl-12">
                      {auto.keyword_filter_enabled && (auto.keywords?.length ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Filter className="size-3" />
                          Keywords: {auto.keywords.slice(0, 3).join(", ")}
                          {auto.keywords.length > 3 && ` +${auto.keywords.length - 3}`}
                        </span>
                      )}
                      {(qrCount > 0 || btnCount > 0) && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <MessageCircle className="size-3" />
                          {qrCount + btnCount} botão(ões)
                        </span>
                      )}
                      {auto.instagram_post_id === "*" && (
                        <span className="text-[11px] text-muted-foreground">
                          Comentário em qualquer post
                        </span>
                      )}
                    </div>
                  </div>

                  <span className="hidden sm:block text-sm text-right tabular-nums">
                    {auto.total_sent && auto.total_sent > 0 ? auto.total_sent : "—"}
                  </span>
                  <span className="hidden sm:block text-sm text-right tabular-nums text-muted-foreground">
                    {ctr(auto)}
                  </span>
                  <span className="hidden sm:block text-xs text-right text-muted-foreground">
                    {formatDate(auto.updated_at)}
                  </span>

                  <div className="absolute right-2 top-2 sm:static sm:flex sm:justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem asChild>
                          <Link to="/automations/$id/edit" params={{ id: auto.id }}>
                            <Pencil className="size-3.5 mr-2" />
                            Editar
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={duplicateM.isPending}
                          onClick={() => duplicateM.mutate(auto)}
                        >
                          <Copy className="size-3.5 mr-2" />
                          Duplicar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            toggleM.mutate({ id: auto.id, is_active: !auto.is_active })
                          }
                        >
                          <TrendingUp className="size-3.5 mr-2" />
                          {auto.is_active ? "Pausar" : "Ativar"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            if (
                              confirm(`Apagar a automação "${auto.name}"? Essa ação não tem volta.`)
                            ) {
                              deleteM.mutate(auto.id);
                            }
                          }}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="size-3.5 mr-2" />
                          Apagar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
