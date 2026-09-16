import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Send,
  TrendingUp,
  MessageCircle,
  MousePointerClick,
  Loader2,
  Check,
  ArrowRight,
} from "lucide-react";
import { getDashboardStats } from "@/functions/dashboard.functions";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_dashboard/dashboard")({
  component: DashboardPage,
});

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function DashboardPage() {
  const { user } = useAuth();
  const [timezoneOffset, setTimezoneOffset] = useState(0);
  useEffect(() => setTimezoneOffset(new Date().getTimezoneOffset()), []);
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard-stats", timezoneOffset],
    queryFn: () => getDashboardStats({ data: { timezoneOffsetMinutes: timezoneOffset } }),
  });

  const stats = [
    { title: "DMs Enviadas", value: data ? String(data.total_sent) : "—", icon: Send },
    {
      title: "Cliques em botões",
      value: data ? String(data.total_clicks) : "—",
      sub: data?.ctr == null ? undefined : `CTR ${data.ctr.toFixed(1)}%`,
      icon: MousePointerClick,
    },
    {
      title: "Taxa de Entrega",
      value: data?.delivery_rate == null ? "—" : `${data.delivery_rate.toFixed(1)}%`,
      icon: TrendingUp,
    },
    {
      title: "Respostas Hoje",
      value: data ? String(data.replies_today) : "—",
      icon: MessageCircle,
    },
  ];

  const setupSteps = data
    ? [
        {
          done: data.setup.has_api_key,
          label: "Salvar a API Key da Zernio",
          to: "/settings" as const,
        },
        {
          done: data.setup.instagram_connected,
          label: "Conectar o Instagram",
          to: "/settings" as const,
        },
        {
          done: data.setup.has_public_url,
          label: "Configurar a URL do webhook (app publicado)",
          to: "/settings" as const,
        },
        {
          done: data.setup.has_active_automation,
          label: "Ativar a primeira automação ou flow",
          to: "/automations" as const,
        },
      ]
    : [];
  const setupPending = setupSteps.some((s) => !s.done);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {greeting()}
          {user?.email ? `, ${user.email.split("@")[0]}` : ""}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {data
            ? `${data.active_automations} automação(ões) e ${data.active_flows} flow(s) ativos`
            : "Resumo das suas automações"}
        </p>
      </div>

      {error && !data && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Não foi possível carregar o resumo: {error.message}
        </div>
      )}

      {!isLoading && setupPending && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Termine de configurar</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {setupSteps.map((step, i) => (
              <Link
                key={i}
                to={step.to}
                className="group flex items-center gap-3 rounded-md px-1 py-1 transition-colors hover:bg-primary/10"
              >
                <div
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                    step.done
                      ? "bg-emerald-500/15 text-emerald-500"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {step.done ? <Check className="size-3.5" /> : i + 1}
                </div>
                <span
                  className={`text-sm ${step.done ? "text-muted-foreground line-through" : ""}`}
                >
                  {step.label}
                </span>
                {!step.done && (
                  <ArrowRight className="ml-auto size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title} className="shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <div className="rounded-lg bg-primary/10 p-2.5">
                  <Icon className="size-4 text-primary" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold tracking-tight">
                  {isLoading ? (
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  ) : (
                    stat.value
                  )}
                </p>
                {"sub" in stat && stat.sub && (
                  <p className="mt-1 text-xs text-muted-foreground">{stat.sub}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
