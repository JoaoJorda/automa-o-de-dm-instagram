// Painel lateral de configuração do passo/gatilho selecionado.
// Estado local + botão Salvar → store (padrão Dispara); key={id} remonta ao
// trocar a seleção.
import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MAX_BUTTONS, MAX_QUICK_REPLIES, type FlowButton } from "@/lib/flow-model";
import {
  findStep,
  STEP_META,
  type ConditionConfig,
  type MessageConfig,
  type PrivateReplyConfig,
} from "@/lib/flow-tree";
import { useFlowBuilderStore, TRIGGER_SELECTION_ID, type FlowMeta } from "./store";

export function ConfigPanel() {
  const selectedId = useFlowBuilderStore((s) => s.selectedId);
  const tree = useFlowBuilderStore((s) => s.tree);
  const select = useFlowBuilderStore((s) => s.select);

  if (!selectedId) return null;
  const isTrigger = selectedId === TRIGGER_SELECTION_ID;
  const step = isTrigger ? null : findStep(tree, selectedId);
  if (!isTrigger && !step) return null;

  return (
    <div className="absolute inset-y-0 right-0 z-40 flex w-[380px] max-w-full flex-col border-l border-border bg-card shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">
          {isTrigger ? "Gatilho" : STEP_META[step!.type].label}
        </h3>
        <Button variant="ghost" size="icon" className="size-7" onClick={() => select(null)}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {isTrigger ? (
          <TriggerPanel key="trigger" />
        ) : step!.type === "privateReply" ? (
          <PrivateReplyPanel key={step!.id} stepId={step!.id} />
        ) : step!.type === "condition" ? (
          <ConditionPanel key={step!.id} stepId={step!.id} />
        ) : (
          <MessagePanel key={step!.id} stepId={step!.id} />
        )}
      </div>
    </div>
  );
}

function SaveRow({ onSave }: { onSave: () => void }) {
  return (
    <Button className="mt-4 w-full" onClick={onSave}>
      Salvar passo
    </Button>
  );
}

function TriggerPanel() {
  const meta = useFlowBuilderStore((s) => s.meta);
  const patchMeta = useFlowBuilderStore((s) => s.patchMetaTracked);
  const select = useFlowBuilderStore((s) => s.select);
  const [draft, setDraft] = useState<FlowMeta>(meta);

  const isComment = draft.trigger_type === "comment";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Tipo de gatilho</Label>
        <Select
          value={draft.trigger_type}
          onValueChange={(v) => setDraft({ ...draft, trigger_type: v as "comment" | "dm" })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="comment">Comentário em post/reel</SelectItem>
            <SelectItem value="dm">DM recebida com palavra-chave</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Flows têm prioridade: se este gatilho casar, a automação clássica do mesmo
          post/palavra-chave não dispara. Com post &quot;*&quot; e sem filtro de palavras, este flow
          captura <strong>todos</strong> os comentários.
        </p>
      </div>

      {isComment && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>ID do post (ou * pra qualquer post)</Label>
            <Input
              value={draft.instagram_post_id}
              onChange={(e) => setDraft({ ...draft, instagram_post_id: e.target.value })}
              placeholder="*"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Tipo de conteúdo</Label>
            <Select
              value={draft.instagram_post_type}
              onValueChange={(v) => setDraft({ ...draft, instagram_post_type: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="post">Post / Reel</SelectItem>
                <SelectItem value="story">Story</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label>Filtrar por palavras-chave</Label>
            <Switch
              checked={draft.keyword_filter_enabled}
              onCheckedChange={(v) => setDraft({ ...draft, keyword_filter_enabled: v })}
            />
          </div>
        </>
      )}

      {(draft.keyword_filter_enabled || !isComment) && (
        <div className="flex flex-col gap-1.5">
          <Label>
            Palavras-chave (separadas por vírgula)
            {!isComment && <span className="text-destructive"> *</span>}
          </Label>
          <Input
            value={draft.keywords}
            onChange={(e) => setDraft({ ...draft, keywords: e.target.value })}
            placeholder="quero, link, eu"
          />
          {!isComment && (
            <p className="text-[11px] text-muted-foreground">
              Obrigatório no gatilho de DM — sem elas o flow responderia toda mensagem.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <Label>Exigir seguir para receber</Label>
          <p className="text-[11px] text-muted-foreground">
            Quem não segue recebe o pedido de follow antes.
          </p>
        </div>
        <Switch
          checked={draft.require_follow}
          onCheckedChange={(v) => setDraft({ ...draft, require_follow: v })}
        />
      </div>

      {draft.require_follow && (
        <div className="flex flex-col gap-1.5">
          <Label>Mensagem do pedido de follow</Label>
          <Textarea
            value={draft.follower_gate_message}
            onChange={(e) => setDraft({ ...draft, follower_gate_message: e.target.value })}
            maxLength={500}
            rows={3}
            placeholder="Esse conteúdo é exclusivo para seguidores! Me segue e clica em 'Pronto' 😉"
          />
        </div>
      )}

      <SaveRow
        onSave={() => {
          // Patch SÓ dos campos do gatilho: name/is_active seguem editáveis
          // no toolbar enquanto o painel está aberto — o snapshot completo
          // clobberaria essas edições (podia até desativar um flow recém-ativado).
          patchMeta({
            trigger_type: draft.trigger_type,
            instagram_post_id: draft.instagram_post_id,
            instagram_post_type: draft.instagram_post_type,
            keyword_filter_enabled: draft.keyword_filter_enabled,
            keywords: draft.keywords,
            require_follow: draft.require_follow,
            follower_gate_message: draft.follower_gate_message,
          });
          select(null);
        }}
      />
    </div>
  );
}

function PrivateReplyPanel({ stepId }: { stepId: string }) {
  const tree = useFlowBuilderStore((s) => s.tree);
  const patchStepConfig = useFlowBuilderStore((s) => s.patchStepConfig);
  const select = useFlowBuilderStore((s) => s.select);
  const step = findStep(tree, stepId)!;
  const [text, setText] = useState((step.config as PrivateReplyConfig).text);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Texto da resposta privada</Label>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          rows={5}
          placeholder="Oi! Vi seu comentário — te mandei o link aqui 👇"
        />
        <p className="text-[11px] text-muted-foreground">
          DM privada respondendo o comentário. Texto puro (sem botões) — os botões vão na Mensagem
          seguinte.
        </p>
      </div>
      <SaveRow
        onSave={() => {
          patchStepConfig(stepId, { text });
          select(null);
        }}
      />
    </div>
  );
}

function ConditionPanel({ stepId }: { stepId: string }) {
  const tree = useFlowBuilderStore((s) => s.tree);
  const patchStepConfig = useFlowBuilderStore((s) => s.patchStepConfig);
  const select = useFlowBuilderStore((s) => s.select);
  const step = findStep(tree, stepId)!;
  const [keywords, setKeywords] = useState((step.config as ConditionConfig).keywords.join(", "));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Palavras-chave (separadas por vírgula)</Label>
        <Input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="sim, quero, pode ser"
        />
        <p className="text-[11px] text-muted-foreground">
          O flow espera a PRÓXIMA resposta da pessoa: se contiver alguma dessas palavras, segue por
          "Se contém"; senão, por "Se não contém".
        </p>
      </div>
      <SaveRow
        onSave={() => {
          patchStepConfig(stepId, {
            keywords: keywords
              .split(",")
              .map((k) => k.trim())
              .filter(Boolean),
          });
          select(null);
        }}
      />
    </div>
  );
}

function MessagePanel({ stepId }: { stepId: string }) {
  const tree = useFlowBuilderStore((s) => s.tree);
  const patchStepConfig = useFlowBuilderStore((s) => s.patchStepConfig);
  const select = useFlowBuilderStore((s) => s.select);
  const step = findStep(tree, stepId)!;
  const cfg = step.config as MessageConfig;
  const qrBranches = (step.branches ?? []).filter((branch) => branch.kind === "qr");
  const btnBranches = (step.branches ?? []).filter((branch) => branch.kind === "btn");
  const [text, setText] = useState(cfg.text);
  // Opções legadas sem id ganham o id da branch por POSIÇÃO uma única vez, na
  // hidratação (contra o estado SALVO). Depois disso tudo segue por identidade
  // — remoções locais antes do save não desalinham o mapeamento.
  const [quickReplies, setQuickReplies] = useState(() =>
    (cfg.quickReplies ?? []).map((q, i) => (q.id ? q : { ...q, id: qrBranches[i]?.id })),
  );
  const [buttons, setButtons] = useState<FlowButton[]>(() => {
    let postbackIndex = -1;
    return (cfg.buttons ?? []).map((b) => {
      if (b.type !== "postback") return b;
      postbackIndex += 1;
      return b.id ? b : { ...b, id: btnBranches[postbackIndex]?.id };
    });
  });
  const branchHasChild = (optionId?: string) =>
    !!optionId && !!step.branches?.some((branch) => branch.id === optionId && branch.child);
  const confirmBranchRemoval = (optionId?: string): boolean =>
    !branchHasChild(optionId) ||
    confirm(
      "Esta opção tem passos conectados. Remover a opção também apagará esse caminho. Continuar?",
    );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label>Texto da mensagem</Label>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          rows={4}
          placeholder="Aqui está o que você pediu 🎉"
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>
            Quick replies{" "}
            <span className="text-muted-foreground">
              ({quickReplies.length}/{MAX_QUICK_REPLIES})
            </span>
          </Label>
          <Button
            variant="outline"
            size="sm"
            disabled={quickReplies.length >= MAX_QUICK_REPLIES}
            onClick={() =>
              // id estável: identifica a branch/handle da opção pra sempre —
              // remover/reordenar outras opções não desloca este caminho.
              setQuickReplies([...quickReplies, { id: crypto.randomUUID(), title: "" }])
            }
          >
            Adicionar
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Cada quick reply vira um caminho de saída no flow (o clique avança).
        </p>
        {quickReplies.map((q, i) => (
          <div key={q.id ?? i} className="flex gap-2">
            <Input
              value={q.title}
              maxLength={20}
              placeholder={`Opção ${i + 1}`}
              onChange={(e) => {
                const next = [...quickReplies];
                // Preserva o id — sem ele o sync criaria branch nova e o
                // caminho existente da opção se perderia.
                next[i] = { ...q, title: e.target.value };
                setQuickReplies(next);
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => {
                if (confirmBranchRemoval(q.id)) {
                  setQuickReplies(quickReplies.filter((_, j) => j !== i));
                }
              }}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>
            Botões{" "}
            <span className="text-muted-foreground">
              ({buttons.length}/{MAX_BUTTONS})
            </span>
          </Label>
          <Button
            variant="outline"
            size="sm"
            disabled={buttons.length >= MAX_BUTTONS}
            onClick={() =>
              setButtons([
                ...buttons,
                { id: crypto.randomUUID(), type: "web_url", title: "", url: "" },
              ])
            }
          >
            Adicionar
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Link abre uma URL; Postback vira um caminho de saída no flow.
        </p>
        {buttons.map((b, i) => (
          <div
            key={b.id ?? i}
            className="flex flex-col gap-2 rounded-lg border border-border p-2.5"
          >
            <div className="flex gap-2">
              <Select
                value={b.type}
                onValueChange={(v) => {
                  if (b.type === "postback" && v === "web_url" && !confirmBranchRemoval(b.id)) {
                    return;
                  }
                  const next = [...buttons];
                  next[i] = { ...b, type: v as FlowButton["type"] };
                  setButtons(next);
                }}
              >
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="web_url">Link</SelectItem>
                  <SelectItem value="postback">Postback</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={b.title}
                maxLength={20}
                placeholder="Título do botão"
                onChange={(e) => {
                  const next = [...buttons];
                  next[i] = { ...b, title: e.target.value };
                  setButtons(next);
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (confirmBranchRemoval(b.id)) {
                    setButtons(buttons.filter((_, j) => j !== i));
                  }
                }}
              >
                <X className="size-4" />
              </Button>
            </div>
            {b.type === "web_url" && (
              <Input
                value={b.url ?? ""}
                placeholder="https://…"
                onChange={(e) => {
                  const next = [...buttons];
                  next[i] = { ...b, url: e.target.value };
                  setButtons(next);
                }}
              />
            )}
          </div>
        ))}
      </div>

      <SaveRow
        onSave={() => {
          patchStepConfig(stepId, { text, quickReplies, buttons });
          select(null);
        }}
      />
    </div>
  );
}
