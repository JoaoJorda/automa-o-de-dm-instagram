import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  KeyRound,
  Copy,
  Check,
  Trash2,
  Loader2,
  Plus,
  ShieldCheck,
  Terminal,
  Download,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listApiKeys, createApiKey, revokeApiKey } from "@/functions/api-keys.functions";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error("Não consegui copiar. Selecione o texto e copie manualmente.");
        }
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {label ?? (copied ? "Copiado" : "Copiar")}
    </Button>
  );
}

export function ApiKeysPanel({ publicAppOrigin }: { publicAppOrigin: string | null }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => listApiKeys(),
  });

  const createM = useMutation({
    mutationFn: (n: string) => createApiKey({ data: { name: n } }),
    onSuccess: (r) => {
      setNewKey(r.plainKey);
      setName("");
      toast.success("Chave criada — copie agora, ela não aparece de novo.");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeM = useMutation({
    mutationFn: (id: string) => revokeApiKey({ data: { id } }),
    onSuccess: () => {
      toast.success("Chave revogada");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const origin =
    publicAppOrigin ?? (typeof window !== "undefined" ? window.location.origin : "https://seuapp.lovable.app");
  const endpoint = `${origin}/api/public/metrics`;
  const curl = `curl -H "Authorization: Bearer SUA_CHAVE" "${endpoint}"`;

  const keys = data?.keys ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            Endereço da API
          </CardTitle>
          <CardDescription>
            Endpoint somente leitura (GET) com as métricas do sistema: DMs enviadas, cliques em
            botões, taxa de entrega e respostas hoje — no total e por usuário.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs break-all">
              {endpoint}
            </code>
            <div className="flex shrink-0 items-center gap-2">
              <CopyButton value={endpoint} />
              <Button asChild variant="outline" size="sm">
                <a href="/docs/InstaDesbloqMe-API-Metricas.pdf" download>
                  <Download className="size-3.5" />
                  Download Doc
                </a>
              </Button>
            </div>
          </div>
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Terminal className="size-3.5" />
              Exemplo de chamada
            </p>
            <code className="block text-xs break-all">{curl}</code>
          </div>
          <p className="text-xs text-muted-foreground">
            Parâmetros opcionais: <code>?tzOffset=180</code> (fuso em minutos, para o cálculo de
            &quot;hoje&quot;) e <code>?userId=&lt;uuid&gt;</code> para filtrar um usuário.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            Chaves de API
          </CardTitle>
          <CardDescription>
            Cada chave dá acesso de leitura às métricas gerais e de todos os usuários. Guarde-a em
            local seguro e revogue se suspeitar de vazamento.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="key-name">Nome da chave</Label>
              <Input
                id="key-name"
                placeholder="CRM principal"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
            </div>
            <Button
              onClick={() => createM.mutate(name)}
              disabled={!name.trim() || createM.isPending}
            >
              {createM.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Criar chave
            </Button>
          </div>

          {newKey && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
              <p className="mb-2 text-sm font-medium">
                Copie sua chave agora — ela não será exibida novamente.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="flex-1 rounded-md bg-background px-3 py-2 text-xs break-all">
                  {newKey}
                </code>
                <CopyButton value={newKey} />
                <Button variant="ghost" size="sm" onClick={() => setNewKey(null)}>
                  Ocultar
                </Button>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : keys.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhuma chave criada ainda.
            </p>
          ) : (
            <div className="flex flex-col divide-y rounded-md border">
              {keys.map((k) => (
                <div
                  key={k.id}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {k.name}
                      {k.revoked_at && <Badge variant="destructive">revogada</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <code>{k.key_prefix}…</code> · criada {formatDate(k.created_at)} · último uso{" "}
                      {formatDate(k.last_used_at)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => revokeM.mutate(k.id)}
                    disabled={revokeM.isPending}
                  >
                    <Trash2 className="size-4" />
                    Revogar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
