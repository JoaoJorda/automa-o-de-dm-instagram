import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Key,
  Camera,
  Webhook,
  Loader2,
  Check,
  X,
  Send,
  Eye,
  EyeOff,
  BookOpen,
  Copy,
  CheckCircle2,
  ExternalLink,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiKeysPanel } from "@/components/api-keys-panel";
import {
  getSettings,
  saveZernioApiKey,
  connectInstagram,
  disconnectInstagram,
  saveOutgoingWebhook,
  testConfiguration,
  redetectPublishedOrigin,
  setPublishedOrigin,
} from "@/functions/settings.functions";

export const Route = createFileRoute("/_dashboard/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettings(),
  });

  const settings = data?.settings;
  const profile = data?.profile;
  const publicAppOrigin = data?.publicAppOrigin ?? null;
  const webhookEndpoint =
    publicAppOrigin && profile?.webhook_token
      ? `${publicAppOrigin}/api/webhooks/zernio/${profile.webhook_token}`
      : "";

  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [testResults, setTestResults] = useState<
    { step: string; status: "ok" | "fail" | "warn"; detail?: string }[] | null
  >(null);

  useEffect(() => {
    if (settings) {
      setWebhookUrl(settings.outgoing_webhook_url ?? "");
      setWebhookEnabled(settings.outgoing_webhook_enabled);
    }
  }, [settings]);

  const saveKeyM = useMutation({
    mutationFn: (k: string) => saveZernioApiKey({ data: { apiKey: k } }),
    onSuccess: () => {
      toast.success("API Key salva");
      setApiKey("");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const connectIgM = useMutation({
    mutationFn: () => connectInstagram(),
    onSuccess: (r) => {
      if (r.error || !r.username) {
        toast.error(r.error ?? "Não foi possível conectar o Instagram.");
        return;
      }
      toast.success(`Conectado: @${r.username}`);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const disconnectIgM = useMutation({
    mutationFn: () => disconnectInstagram(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const saveWebhookM = useMutation({
    mutationFn: () => saveOutgoingWebhook({ data: { url: webhookUrl, enabled: webhookEnabled } }),
    onSuccess: () => {
      toast.success("Webhook salvo");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testM = useMutation({
    mutationFn: () => testConfiguration(),
    onSuccess: (r) => setTestResults(r.results),
    onError: (e: Error) => toast.error(e.message),
  });

  const [zernioResults, setZernioResults] = useState<
    { step: string; status: "ok" | "fail"; detail?: string }[] | null
  >(null);
  const testZernioM = useMutation({
    mutationFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();
      if (error) throw new Error(`Falha ao validar sua sessão: ${error.message}`);
      const res = await fetch("/api/debug/zernio", {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{
        results: { step: string; status: "ok" | "fail"; detail?: string }[];
      }>;
    },
    onSuccess: (r) => setZernioResults(r.results),
    onError: (e: Error) => toast.error(e.message),
  });

  // Mesma lista de isPreviewHostname (server) — manter em sincronia.
  function isPreviewHost(): boolean {
    if (typeof window === "undefined") return false;
    const h = window.location.hostname.toLowerCase();
    return (
      h.endsWith(".lovableproject.com") ||
      h.startsWith("id-preview--") ||
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "0.0.0.0" ||
      h === "::1" ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
    );
  }

  const [manualUrl, setManualUrl] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);

  const setOriginM = useMutation({
    mutationFn: (url: string) => setPublishedOrigin({ data: { url } }),
    onSuccess: (r) => {
      if (r.verified) {
        toast.success("URL verificada e salva — seu webhook está acessível nesse endereço.");
      } else {
        toast.warning(
          "URL salva, mas não consegui confirmar o endpoint. Confira se o app está publicado exatamente nessa URL.",
          { duration: 8000 },
        );
      }
      setManualUrl("");
      setShowManualInput(false);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refreshOriginM = useMutation({
    mutationFn: async () => {
      if (isPreviewHost()) {
        throw new Error(
          'Você está no editor preview — aqui a URL não é detectável. Abra o app pelo link publicado e faça login lá uma vez, ou cole a URL publicada no campo "Definir manualmente".',
        );
      }
      // Atômico: se não detectar, o servidor não apaga nada — a URL atual
      // (inclusive manual) permanece.
      return redetectPublishedOrigin();
    },
    onSuccess: (r) => {
      toast.success(`URL pública detectada: ${r.origin}`);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => toast.info(e.message, { duration: 8000 }),
  });

  async function copyWebhookUrl() {
    if (!webhookEndpoint) return;
    try {
      await navigator.clipboard.writeText(webhookEndpoint);
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    } catch {
      toast.error("Não consegui copiar a URL. Selecione o texto e copie manualmente.");
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Só troca a página pelo erro quando NÃO há nada carregado — falha de um
  // refetch em background mantém a tela funcional com os dados stale.
  if (!settings) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <p className="text-sm text-destructive">
          {error?.message || "Não foi possível carregar as configurações."}
        </p>
      </div>
    );
  }

  const hasApiKey = settings.has_api_key;
  const instagramConnected = settings.instagram_connected;

  const steps = [
    { label: "Criar conta na Zernio", done: true },
    { label: "Salvar API Key", done: hasApiKey },
    { label: "Conectar Instagram", done: instagramConnected },
    { label: "Configurar Webhook na Zernio", done: false },
  ];
  const completedSteps = steps.filter((s) => s.done).length;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>

      <Tabs defaultValue="geral">
        <TabsList>
          <TabsTrigger value="geral">Geral</TabsTrigger>
          <TabsTrigger value="api">API</TabsTrigger>
        </TabsList>

        <TabsContent value="api" className="mt-6">
          <ApiKeysPanel publicAppOrigin={publicAppOrigin} />
        </TabsContent>

        <TabsContent value="geral" className="mt-6 flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-4" />
            Guia de Configuração
          </CardTitle>
          <CardDescription>
            {completedSteps}/{steps.length} etapas concluídas. Siga o passo a passo para ativar suas
            automações.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-700 dark:text-yellow-400 flex gap-3">
              <AlertTriangle className="size-5 shrink-0 mt-0.5" />
              <p>
                <strong>Publique o projeto antes de mais nada.</strong> Sem publicá-lo não vai
                funcionar. Clique em Publish, botão azul no canto superior direito da tela. Aguarde
                finalizar a publicação e acesse o link público para poder usar o sistema e realizar
                as devidas configurações e para o sistema gerar a URL do webhook correta para você
                inserir na Zernio.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                      step.done
                        ? "bg-green-500/10 text-green-500"
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
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm flex flex-col gap-3">
              <p className="font-medium">Como configurar:</p>
              <ol className="list-decimal list-inside flex flex-col gap-2 text-muted-foreground">
                <li>
                  Crie uma conta em{" "}
                  <a
                    href="https://zernio.com/signup?ref=9471CBEA"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline inline-flex items-center gap-1"
                  >
                    zernio.com <ExternalLink className="size-3" />
                  </a>{" "}
                  e ative o add-on <strong>Inbox</strong>
                </li>
                <li>
                  Cole sua <strong>API Key</strong> da Zernio abaixo
                </li>
                <li>
                  Clique em <strong>Conectar Instagram</strong>
                </li>
                <li>
                  Na Zernio, configure um webhook com:
                  <div className="mt-2 ml-4 flex flex-col gap-2">
                    <Label className="text-xs font-medium">URL do Webhook</Label>
                    <div className="flex gap-2 items-stretch">
                      <div
                        className={`flex-1 min-w-0 rounded-md border px-3 py-2 text-xs break-all flex items-center ${
                          webhookEndpoint
                            ? "border-input bg-background font-mono"
                            : "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                        }`}
                      >
                        {webhookEndpoint ||
                          (isPreviewHost()
                            ? "URL ainda não detectada — você está no preview do editor. Abra o app pelo link publicado e faça login lá uma vez, ou cole a URL publicada abaixo."
                            : "URL ainda não detectada — publique o app e faça login por ele uma vez, ou cole a URL publicada abaixo.")}
                      </div>
                      {webhookEndpoint && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={copyWebhookUrl}
                          title="Copiar URL"
                        >
                          {copiedWebhook ? (
                            <CheckCircle2 className="size-4 text-green-500" />
                          ) : (
                            <Copy className="size-4" />
                          )}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => refreshOriginM.mutate()}
                        disabled={refreshOriginM.isPending}
                        title={
                          webhookEndpoint ? "Redetectar URL pública" : "Tentar detectar URL pública"
                        }
                      >
                        {refreshOriginM.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <RefreshCw className="size-4" />
                        )}
                        {webhookEndpoint ? "Atualizar" : "Detectar"}
                      </Button>
                    </div>
                    {(!webhookEndpoint || showManualInput) && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        <Label className="text-xs font-medium">
                          Definir manualmente — cole a URL do seu app publicado
                        </Label>
                        <div className="flex gap-2">
                          <Input
                            type="url"
                            placeholder="https://seuapp.lovable.app"
                            value={manualUrl}
                            onChange={(e) => setManualUrl(e.target.value)}
                            className="flex-1 text-xs"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setOriginM.mutate(manualUrl)}
                            disabled={!manualUrl.trim() || setOriginM.isPending}
                          >
                            {setOriginM.isPending ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              "Salvar URL"
                            )}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground/70">
                          É a URL que abre quando você acessa o app publicado (fora do editor).
                          Vamos verificar o endereço automaticamente ao salvar.
                        </p>
                      </div>
                    )}
                    {webhookEndpoint && !showManualInput && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline underline-offset-2 self-start mt-1 hover:text-foreground"
                        onClick={() => setShowManualInput(true)}
                      >
                        URL errada? Definir manualmente
                      </button>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Eventos: <strong>comment.received</strong> e <strong>message.received</strong>
                    </p>
                  </div>
                </li>
              </ol>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Sua URL de webhook é única e exclusiva pra sua conta.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <Button
                onClick={() => testM.mutate()}
                disabled={testM.isPending}
                className="w-full font-semibold py-5"
              >
                {testM.isPending ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle2 className="size-4 mr-2" />
                )}
                Testar Configuração
              </Button>

              {testResults && (
                <div className="rounded-lg border border-border bg-muted/30 p-4 flex flex-col gap-2.5">
                  {testResults.map((r, i) => (
                    <div key={i} className="flex items-start gap-2.5 text-sm">
                      {r.status === "ok" ? (
                        <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-green-500/10 mt-0.5">
                          <Check className="size-3 text-green-500" />
                        </div>
                      ) : r.status === "warn" ? (
                        <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-yellow-500/10 mt-0.5">
                          <AlertTriangle className="size-3 text-yellow-500" />
                        </div>
                      ) : (
                        <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/10 mt-0.5">
                          <X className="size-3 text-destructive" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{r.step}</span>
                        {r.detail && (
                          <p className="text-xs text-muted-foreground mt-0.5 break-all">
                            {r.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Button
                onClick={() => testZernioM.mutate()}
                disabled={testZernioM.isPending}
                variant="outline"
                className="w-full"
              >
                {testZernioM.isPending ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="size-4 mr-2" />
                )}
                Testar Zernio (API + Inbox)
              </Button>

              {zernioResults && (
                <div className="rounded-lg border border-border bg-muted/30 p-4 flex flex-col gap-2.5">
                  {zernioResults.map((r, i) => (
                    <div key={i} className="flex items-start gap-2.5 text-sm">
                      {r.status === "ok" ? (
                        <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-green-500/10 mt-0.5">
                          <Check className="size-3 text-green-500" />
                        </div>
                      ) : (
                        <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/10 mt-0.5">
                          <X className="size-3 text-destructive" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{r.step}</span>
                        {r.detail && (
                          <p className="text-xs text-muted-foreground mt-0.5 break-all">
                            {r.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Key className="size-4 text-primary" />
                <Label className="text-sm font-medium">Etapa 2 — Zernio API Key</Label>
                {hasApiKey && (
                  <Badge className="bg-green-500/10 text-green-500 border-0 ml-auto text-xs">
                    Configurada
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Sua API key é criptografada antes de ser armazenada.
              </p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showApiKey ? "text" : "password"}
                    placeholder={hasApiKey ? "••••••••••••••••" : "Cole sua Zernio API key aqui"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 text-muted-foreground"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
                <Button
                  onClick={() => saveKeyM.mutate(apiKey)}
                  disabled={!apiKey.trim() || saveKeyM.isPending}
                >
                  {saveKeyM.isPending ? <Loader2 className="size-4 animate-spin" /> : "Salvar"}
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-border p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Camera className="size-4 text-primary" />
                <Label className="text-sm font-medium">Etapa 3 — Conectar Instagram</Label>
                {instagramConnected && settings.instagram_username && (
                  <Badge className="bg-green-500/10 text-green-500 border-0 ml-auto text-xs">
                    @{settings.instagram_username}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Conecte sua conta do Instagram via Zernio para ativar automações.
              </p>
              {instagramConnected ? (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => connectIgM.mutate()}
                    disabled={connectIgM.isPending}
                  >
                    <Camera className="size-3.5" />
                    Reconectar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => disconnectIgM.mutate()}
                    disabled={disconnectIgM.isPending}
                  >
                    <X className="size-3.5" />
                    Desconectar
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={() => connectIgM.mutate()}
                  size="sm"
                  disabled={!hasApiKey || connectIgM.isPending}
                >
                  {connectIgM.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Camera className="size-4" />
                  )}
                  Conectar Instagram
                </Button>
              )}
              {!hasApiKey && (
                <p className="text-xs text-muted-foreground">
                  Salve sua Zernio API Key antes de conectar o Instagram.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="size-4" />
            Webhook de Saída
            <Badge variant="secondary" className="text-xs font-normal ml-1">
              Opcional
            </Badge>
          </CardTitle>
          <CardDescription>
            Receba notificações externas quando DMs forem enviadas. Útil pra integrar com CRMs, n8n,
            Make, etc.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Label htmlFor="webhook-toggle" className="text-sm">
                {webhookEnabled ? "Ativado" : "Desativado"}
              </Label>
              <Switch
                id="webhook-toggle"
                checked={webhookEnabled}
                onCheckedChange={setWebhookEnabled}
              />
            </div>
            <div className="flex gap-2">
              <Input
                type="url"
                placeholder="https://example.com/webhook"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={() => saveWebhookM.mutate()}
                disabled={saveWebhookM.isPending}
              >
                {saveWebhookM.isPending ? <Loader2 className="size-4 animate-spin" /> : "Salvar"}
              </Button>
              <Button variant="outline" disabled={!webhookUrl.trim()}>
                <Send className="size-4" />
                Testar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
