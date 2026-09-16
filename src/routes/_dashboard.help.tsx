import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  BookOpen,
  Rocket,
  LayoutDashboard,
  Bot,
  FileText,
  ScrollText,
  Settings,
  Webhook,
  Lightbulb,
  HelpCircle,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_dashboard/help")({
  component: HelpPage,
});

const sections = [
  { id: "overview", label: "Visão Geral", icon: BookOpen },
  { id: "first-steps", label: "Primeiros Passos", icon: Rocket },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "automations", label: "Automações", icon: Bot },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "settings", label: "Configurações", icon: Settings },
  { id: "outgoing-webhook", label: "Webhook de Saída", icon: Webhook },
  { id: "best-practices", label: "Boas Práticas", icon: Lightbulb },
  { id: "faq", label: "Solução de Problemas", icon: HelpCircle },
] as const;

function HelpPage() {
  const [activeId, setActiveId] = useState<string>(sections[0].id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 },
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Ajuda</h1>
        <p className="text-muted-foreground mt-1">
          Guia completo de todas as telas e funcionalidades do InstaDesbloqMe.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-8">
        <aside className="hidden lg:block">
          <nav className="sticky top-4 space-y-1">
            {sections.map(({ id, label, icon: Icon }) => (
              <a
                key={id}
                href={`#${id}`}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  activeId === id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="space-y-6 scroll-smooth">
          <Section id="overview" icon={BookOpen} title="Visão Geral">
            <p>
              O <strong>InstaDesbloqMe</strong> automatiza respostas a comentários no Instagram. Quando
              alguém comenta em um post configurado, o sistema envia automaticamente uma DM com a
              mensagem, botões e links que você definiu — usando a integração com a Zernio.
            </p>
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
              <p className="font-medium text-sm">Fluxo end-to-end:</p>
              <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                <li>Usuário comenta no post (ex: "quero")</li>
                <li>Zernio recebe o evento e envia ao webhook do InstaDesbloqMe</li>
                <li>
                  InstaDesbloqMe identifica a automação e envia a <em>private reply</em> (DM inicial)
                </li>
                <li>Em seguida, envia o follow-up com botões/quick replies</li>
                <li>Se o usuário clicar em um botão, recebe a mensagem dedicada daquele botão</li>
              </ol>
            </div>
          </Section>

          <Section id="first-steps" icon={Rocket} title="Primeiros Passos">
            <p>
              Configure tudo na ordem abaixo. Detalhes em{" "}
              <Link to="/settings" className="text-primary underline">
                Configurações
              </Link>
              .
            </p>
            <ol className="space-y-2">
              {[
                "Publique o projeto (necessário para a URL do webhook funcionar).",
                "Crie uma conta na Zernio e ative o addon Inbox.",
                "Cole sua API Key da Zernio em Configurações.",
                "Conecte sua conta do Instagram pela Zernio.",
                "Copie a URL do webhook gerada e cole no painel da Zernio.",
                "Crie sua primeira automação em Automações → Nova.",
              ].map((txt, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" />
                  <span>{txt}</span>
                </li>
              ))}
            </ol>
          </Section>

          <Section id="dashboard" icon={LayoutDashboard} title="Dashboard">
            <p>Visão geral da operação com 4 indicadores principais:</p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <Metric
                title="DMs Enviadas"
                desc="Total de mensagens entregues com sucesso (status sent)."
              />
              <Metric title="Taxa de Sucesso" desc="DMs entregues ÷ comentários processados." />
              <Metric title="Automações Ativas" desc="Total de automações com toggle ligado." />
              <Metric title="Respostas Hoje" desc="DMs enviadas nas últimas 24h." />
            </ul>
          </Section>

          <Section id="automations" icon={Bot} title="Automações">
            <p>
              Lista todas as automações criadas, com toggle de ativar/desativar, duplicar, editar e
              excluir. Mostra também o CTR (cliques ÷ envios) por automação.
            </p>
            <p className="font-medium text-sm pt-2">Campos do formulário:</p>
            <ul className="space-y-2 text-sm">
              <Field
                name="Post alvo"
                desc='ID do post específico, ou "*" para aplicar a todos os posts.'
              />
              <Field
                name="Palavras-chave"
                desc="Lista opcional. Se ativada, só dispara quando o comentário contém uma das palavras."
              />
              <Field
                name="Mensagem inicial (custom_message)"
                desc="Primeira DM enviada via private reply. Obrigatório para abrir a janela de conversa."
              />
              <Field
                name="Follow-up"
                desc="Segunda mensagem enviada após a inicial, normalmente com botões."
              />
              <Field
                name="Quick Replies"
                desc="Botões rápidos exibidos como sugestão de resposta. Cada um pode ter uma reply_message dedicada."
              />
              <Field
                name="Botões (postback / web_url)"
                desc="Postback envia mensagem ao clicar; web_url abre um link externo."
              />
              <Field
                name="Delay mín/máx"
                desc="Aguarda um tempo aleatório nesse intervalo antes de enviar — para parecer mais humano."
              />
            </ul>
          </Section>

          <Section id="templates" icon={FileText} title="Templates">
            <p>
              Modelos prontos de automação. Escolha um template e ele preenche o formulário de
              criação com mensagens e botões sugeridos — basta ajustar e salvar.
            </p>
          </Section>

          <Section id="logs" icon={ScrollText} title="Logs">
            <p>Histórico em tempo real de todos os eventos processados.</p>
            <p className="font-medium text-sm pt-2">Status possíveis:</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">received</Badge>
              <Badge variant="secondary">processing</Badge>
              <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 hover:bg-green-500/20">
                sent
              </Badge>
              <Badge variant="destructive">failed</Badge>
              <Badge variant="outline">skipped</Badge>
            </div>
            <p className="text-sm text-muted-foreground pt-2">
              Use o botão <strong>Sincronizar</strong> para forçar uma atualização. Erros comuns:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
              <li>
                <code>timeout</code>: a Zernio demorou pra responder; tente novamente.
              </li>
              <li>
                <code>INBOX_REQUIRED</code>: ative o addon Inbox no painel da Zernio.
              </li>
              <li>
                <code>conversation not found</code>: a janela de 24h do Instagram pode ter expirado.
              </li>
            </ul>
          </Section>

          <Section id="settings" icon={Settings} title="Configurações">
            <p>Centraliza toda a configuração da integração com a Zernio.</p>
            <ul className="space-y-2 text-sm">
              <Field name="Guia de configuração" desc="Checklist visual com o passo a passo." />
              <Field
                name="API Key da Zernio"
                desc="Chave criptografada usada para chamadas autenticadas."
              />
              <Field name="Instagram" desc="Conectar/desconectar conta vinculada via Zernio." />
              <Field
                name="URL do webhook"
                desc="Cole no painel da Zernio. Só aparece após publicar o projeto e logar pela URL publicada."
              />
              <Field
                name="Testar Configuração"
                desc="Verifica se API Key, Inbox e Instagram estão OK."
              />
              <Field
                name="Webhook de saída"
                desc="Encaminha eventos para sistemas externos (n8n, Make, CRM)."
              />
            </ul>
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 flex gap-2 text-sm">
              <AlertTriangle className="size-4 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
              <span>
                A URL do webhook só aparece quando você acessa o app publicado, nunca pela URL de
                preview.
              </span>
            </div>
          </Section>

          <Section id="outgoing-webhook" icon={Webhook} title="Webhook de Saída">
            <p>
              Ao habilitar, o InstaDesbloqMe faz um <code>POST</code> para a URL configurada toda vez
              que um evento é processado. Útil pra integrar com n8n, Make, Zapier ou seu CRM.
            </p>
            <p className="font-medium text-sm pt-2">Payload enviado:</p>
            <pre className="rounded-lg bg-muted/50 p-3 text-xs overflow-x-auto">
              {`{
  "event": "comment.received",
  "automation_id": "uuid",
  "instagram_user": "@usuario",
  "comment_text": "quero",
  "status": "sent",
  "created_at": "2025-..."
}`}
            </pre>
          </Section>

          <Section id="best-practices" icon={Lightbulb} title="Boas Práticas">
            <ul className="space-y-2 text-sm list-disc list-inside">
              <li>Use palavras-chave específicas para evitar disparos indevidos.</li>
              <li>
                Configure <code>reply_message</code> em cada botão para entregar conteúdo dedicado
                por clique.
              </li>
              <li>Mantenha delays entre 2 e 8 segundos para parecer mais humano.</li>
              <li>Acompanhe os Logs nas primeiras horas após criar uma automação.</li>
              <li>Sempre preencha a mensagem inicial — sem ela a janela de DM não abre.</li>
            </ul>
          </Section>

          <Section id="faq" icon={HelpCircle} title="Solução de Problemas">
            <Faq
              q="URL do webhook não aparece em Configurações"
              a="Publique o projeto e acesse-o pela URL publicada (não a de preview). Faça login uma vez por lá e a URL será detectada automaticamente."
            />
            <Faq
              q="DM não chega ao usuário"
              a='Use "Testar Zernio" em Configurações. Se Inbox falhar, ative o addon no painel da Zernio. Confira também se o Instagram está conectado.'
            />
            <Faq
              q="Botão nativo não funciona"
              a='Garanta que o campo "Mensagem inicial" da automação está preenchido — sem ele a conversa não abre e os botões não chegam.'
            />
            <Faq
              q="Comentário antigo não disparou"
              a="O Instagram só permite responder dentro da janela de 24h após o comentário. Comentários mais antigos são ignorados."
            />
            <Faq
              q="O mesmo usuário recebeu várias DMs"
              a="Verifique se há mais de uma automação ativa para o mesmo post com palavras-chave que se sobrepõem."
            />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  id,
  icon: Icon,
  title,
  children,
}: {
  id: string;
  icon: typeof BookOpen;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Icon className="size-5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-relaxed">{children}</CardContent>
    </Card>
  );
}

function Metric({ title, desc }: { title: string; desc: string }) {
  return (
    <li className="rounded-lg border bg-card p-3">
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground text-xs mt-1">{desc}</p>
    </li>
  );
}

function Field({ name, desc }: { name: string; desc: string }) {
  return (
    <li className="flex flex-col gap-0.5">
      <span className="font-medium">{name}</span>
      <span className="text-muted-foreground">{desc}</span>
    </li>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-lg border p-3 space-y-1">
      <p className="font-medium text-sm">{q}</p>
      <p className="text-sm text-muted-foreground">{a}</p>
    </div>
  );
}
