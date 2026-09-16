import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, MinusCircle, Loader2, RefreshCw } from "lucide-react";
import { listLogs } from "@/functions/logs.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_dashboard/logs")({
  component: LogsPage,
});

function LogsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["logs"],
    queryFn: () => listLogs(),
    // Fallback do realtime: a membership da publication não sobrevive ao clone
    // de um remix — sem isso a lista só atualizaria no refresh manual.
    refetchInterval: 20_000,
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("logs-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "automation_logs",
          filter: `user_id=eq.${user.id}`,
        },
        () => qc.invalidateQueries({ queryKey: ["logs"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, qc]);

  const logs = data?.logs ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Histórico em tempo real das DMs enviadas. {logs.length} eventos recentes.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? "animate-spin" : ""} />
          Sincronizar
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Erro só derruba a tela quando não há NADA carregado: falha de um
          refetch em background (poll de 20s) mantém a lista stale visível. */}
      {error && !data && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Não foi possível carregar os logs: {error.message}
        </div>
      )}

      {!isLoading && data && logs.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          Nenhum log ainda. Quando uma automação disparar, aparecerá aqui.
        </div>
      )}

      {!isLoading && logs.length > 0 && (
        <div className="rounded-lg border border-border divide-y divide-border">
          {logs.map((log) => (
            <div key={log.id} className="flex items-start gap-3 px-4 py-3">
              <div className="mt-0.5">
                {log.status === "sent" ? (
                  <CheckCircle2 className="size-4 text-emerald-500" />
                ) : log.status === "failed" ? (
                  <XCircle className="size-4 text-destructive" />
                ) : (
                  <MinusCircle className="size-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">@{log.instagram_user ?? "anônimo"}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {log.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleString("pt-BR")}
                  </span>
                </div>
                {log.comment_text && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    💬 {log.comment_text}
                  </p>
                )}
                {log.error && <p className="text-xs text-destructive mt-1">⚠ {log.error}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
