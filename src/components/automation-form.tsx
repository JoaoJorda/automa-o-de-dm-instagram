import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Plus, X, MessageCircle, Reply, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { AutomationInput } from "@/functions/automations.functions";

export interface AutomationFormValues {
  name: string;
  instagram_post_id: string;
  instagram_post_type: "post" | "story";
  custom_message: string;
  followup_message: string;
  quick_replies: { title: string; payload: string }[];
  buttons: { type: string; title: string; payload?: string; url?: string }[];
  is_active: boolean;
  keyword_filter_enabled: boolean;
  keywords: string;
  delay_min_seconds: number;
  delay_max_seconds: number;
  trigger_on_dm: boolean;
  require_follow: boolean;
  follower_gate_message: string;
}

interface AutomationFormProps {
  initialValues: AutomationFormValues;
  submitLabel: string;
  submitting: boolean;
  onSubmit: (data: AutomationInput) => void;
}

export function AutomationForm({
  initialValues,
  submitLabel,
  submitting,
  onSubmit,
}: AutomationFormProps) {
  const navigate = useNavigate();
  const [form, setForm] = useState<AutomationFormValues>(initialValues);

  function update<K extends keyof AutomationFormValues>(key: K, value: AutomationFormValues[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function addQuickReply() {
    if (form.quick_replies.length >= 13) return;
    update("quick_replies", [...form.quick_replies, { title: "", payload: "" }]);
  }
  function updateQuickReplyTitle(i: number, title: string) {
    const u = [...form.quick_replies];
    // Payload NÃO é regenerado ao editar o título: payload já existente fica
    // estável (cliques pendentes no Instagram continuam resolvendo a automação
    // certa); itens novos ganham payload no submit.
    u[i] = { ...u[i], title };
    update("quick_replies", u);
  }
  function removeQuickReply(i: number) {
    update(
      "quick_replies",
      form.quick_replies.filter((_, idx) => idx !== i),
    );
  }

  function addButton() {
    if (form.buttons.length >= 3) return;
    update("buttons", [...form.buttons, { type: "postback", title: "", payload: "" }]);
  }
  function updateButton(i: number, field: "title" | "payload" | "url" | "type", value: string) {
    const u = [...form.buttons];
    u[i] = { ...u[i], [field]: value };
    update("buttons", u);
  }
  function updateButtonTitle(i: number, title: string) {
    const u = [...form.buttons];
    // Mesmo racional dos quick replies: título muda, payload existente fica.
    u[i] = { ...u[i], title };
    update("buttons", u);
  }
  function switchButtonType(i: number, type: "postback" | "web_url") {
    const u = [...form.buttons];
    if (type === "web_url") {
      // Preserva o payload pra sobreviver a idas e vindas de tipo.
      u[i] = { type: "web_url", title: u[i].title, url: u[i].url ?? "", payload: u[i].payload };
    } else {
      u[i] = { type: "postback", title: u[i].title, payload: u[i].payload ?? "", url: undefined };
    }
    update("buttons", u);
  }
  function removeButton(i: number) {
    update(
      "buttons",
      form.buttons.filter((_, idx) => idx !== i),
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.custom_message.trim()) {
      toast.error("Mensagem da DM é obrigatória");
      return;
    }
    if (form.is_active && form.keyword_filter_enabled && !form.keywords.trim()) {
      toast.error("Informe ao menos uma palavra-chave ou desative o filtro");
      return;
    }
    const urlButtonInvalid = form.buttons.find(
      (b) => b.title.trim() && b.type === "web_url" && !/^https?:\/\/.+/.test(b.url ?? ""),
    );
    if (urlButtonInvalid) {
      toast.error(
        `Botão "${urlButtonInvalid.title}": URL inválida (deve começar com http:// ou https://)`,
      );
      return;
    }
    onSubmit({
      name: form.name,
      instagram_post_id: form.instagram_post_id,
      instagram_post_type: form.instagram_post_type,
      custom_message: form.custom_message,
      followup_message: form.followup_message,
      // Payload existente é preservado (estabilidade); vazio é preenchido no
      // SERVIDOR com qr:<automationId>:<slug> — namespaced por automação.
      quick_replies: form.quick_replies
        .filter((q) => q.title.trim())
        .map((q) => ({ title: q.title, payload: q.payload ?? "" })),
      buttons: form.buttons
        .filter((b) => b.title.trim())
        .map((b) =>
          b.type === "web_url"
            ? // payload preservado pra sobreviver ao round-trip web_url→postback
              { type: "web_url", title: b.title, url: b.url?.trim() ?? "", payload: b.payload }
            : { type: "postback", title: b.title, payload: b.payload ?? "" },
        ),
      is_active: form.is_active,
      keyword_filter_enabled: form.keyword_filter_enabled,
      keywords: form.keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      delay_min_seconds: form.delay_min_seconds,
      delay_max_seconds: form.delay_max_seconds,
      trigger_on_dm: form.trigger_on_dm,
      require_follow: form.require_follow,
      follower_gate_message: form.follower_gate_message,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex items-center gap-4 py-4">
          <Badge variant="outline">
            {form.instagram_post_id === "*" ? "Todos os posts" : form.instagram_post_type}
          </Badge>
          <span className="text-sm text-muted-foreground truncate">
            ID: {form.instagram_post_id}
          </span>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="auto-name">Nome da automação</Label>
        <Input
          id="auto-name"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="Ex: Ebook gratuito"
          required
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="is-active">Automação ativa</Label>
          <p className="text-xs text-muted-foreground">
            Quando ativa, responde automaticamente aos comentários.
          </p>
        </div>
        <Switch
          id="is-active"
          checked={form.is_active}
          onCheckedChange={(v) => update("is_active", v)}
        />
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <div className="flex items-center gap-2">
          <MessageCircle className="size-4 text-primary" />
          <Label className="text-base font-medium">DM Privada (1ª mensagem)</Label>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Enviada como resposta privada ao comentário. Somente texto.
        </p>
        <textarea
          placeholder="Oi! Obrigado por comentar no nosso post..."
          value={form.custom_message}
          onChange={(e) => update("custom_message", e.target.value)}
          rows={3}
          className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
        />
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <div className="flex items-center gap-2">
          <Reply className="size-4 text-primary" />
          <Label className="text-base font-medium">Follow-up com botões (2ª mensagem)</Label>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Enviada logo após a DM privada. Suporta quick replies e botões nativos. Opcional.
        </p>

        <textarea
          placeholder="Clica no botão abaixo pra receber 👇"
          value={form.followup_message}
          onChange={(e) => update("followup_message", e.target.value)}
          rows={2}
          className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
        />

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>Botões de resposta rápida</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Botões temporários que somem após o clique.
              </p>
            </div>
            <span className="text-xs text-muted-foreground">{form.quick_replies.length}/13</span>
          </div>
          {form.quick_replies.map((qr, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                placeholder="Texto do botão (ex: Quero o link!)"
                value={qr.title}
                onChange={(e) => {
                  const title = e.target.value.slice(0, 20);
                  updateQuickReplyTitle(i, title);
                }}
                maxLength={20}
                className="flex-1"
              />
              <Button type="button" variant="ghost" size="icon" onClick={() => removeQuickReply(i)}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
          {form.quick_replies.length < 13 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addQuickReply}
              className="w-fit"
            >
              <Plus className="size-4 mr-1" /> Adicionar quick reply
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Botões nativos (fixos)</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Botões fixos na mensagem que não desaparecem. Podem responder no DM ou abrir um
                link. Máx 3.
              </p>
            </div>
            <span className="text-xs text-muted-foreground">{form.buttons.length}/3</span>
          </div>
          {form.buttons.map((btn, i) => {
            const isUrl = btn.type === "web_url";
            return (
              <div key={i} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <select
                    value={btn.type}
                    onChange={(e) => switchButtonType(i, e.target.value as "postback" | "web_url")}
                    className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
                  >
                    <option value="postback">Responde no DM</option>
                    <option value="web_url">Abrir link</option>
                  </select>
                  <Input
                    placeholder="Texto do botão (ex: Ver produtos)"
                    value={btn.title}
                    onChange={(e) => updateButtonTitle(i, e.target.value.slice(0, 20))}
                    maxLength={20}
                    className="flex-1"
                  />
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeButton(i)}>
                    <X className="size-4" />
                  </Button>
                </div>
                {isUrl && (
                  <Input
                    placeholder="https://exemplo.com/pagina"
                    type="url"
                    value={btn.url ?? ""}
                    onChange={(e) => updateButton(i, "url", e.target.value)}
                  />
                )}
              </div>
            );
          })}
          {form.buttons.length < 3 && (
            <Button type="button" variant="outline" size="sm" onClick={addButton} className="w-fit">
              <Plus className="size-4 mr-1" /> Adicionar botão nativo
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <Label>Filtro por palavras-chave</Label>
          <Switch
            checked={form.keyword_filter_enabled}
            onCheckedChange={(v) => update("keyword_filter_enabled", v)}
          />
        </div>
        {form.keyword_filter_enabled && (
          <Input
            placeholder="quero, ebook, link (separadas por vírgula)"
            value={form.keywords}
            onChange={(e) => update("keywords", e.target.value)}
          />
        )}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border p-4">
        <div className="flex flex-col gap-0.5">
          <Label>Disparar também em mensagens de story/DM</Label>
          <p className="text-xs text-muted-foreground">
            Quando alguém responder um story ou mandar DM direto, essa automação também dispara
            (respeitando o filtro de palavras-chave, se configurado).
          </p>
        </div>
        <Switch checked={form.trigger_on_dm} onCheckedChange={(v) => update("trigger_on_dm", v)} />
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <Label>Exigir seguir para receber</Label>
            <p className="text-xs text-muted-foreground">
              Se a pessoa não segue seu perfil, pedimos o follow antes de entregar o conteúdo (vale
              pra respostas de DM e cliques em botões desta automação).
            </p>
          </div>
          <Switch
            checked={form.require_follow}
            onCheckedChange={(v) => update("require_follow", v)}
          />
        </div>
        {form.require_follow && (
          <textarea
            placeholder="Esse conteúdo é exclusivo para seguidores! Me segue e clica em 'Pronto' de novo 😉"
            value={form.follower_gate_message}
            onChange={(e) => update("follower_gate_message", e.target.value)}
            rows={2}
            maxLength={500}
            className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
          />
        )}
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-border p-4">
        <Label>Envio imediato</Label>
        <p className="text-xs text-muted-foreground">
          A resposta é enviada assim que o evento chega. O runtime precisa concluir o envio antes de
          responder ao webhook, por isso não aplica espera artificial.
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate({ to: "/automations" })}
          disabled={submitting}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : submitLabel}
        </Button>
      </div>
    </form>
  );
}
