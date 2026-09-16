import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createAutomation } from "@/functions/automations.functions";
import {
  Download,
  Loader2,
  BookOpen,
  ShoppingCart,
  Briefcase,
  Gift,
  Users,
  Megaphone,
  Heart,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_dashboard/templates")({
  component: TemplatesPage,
});

interface AutomationBlueprint {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: React.ElementType;
  custom_message: string;
  followup_message: string;
  quick_replies: { title: string; payload: string }[];
  buttons: { type: string; title: string; payload: string }[];
  keyword_filter_enabled: boolean;
  keywords: string[];
  delay_min_seconds: number;
  delay_max_seconds: number;
}

const categoryStyles: Record<string, string> = {
  infoproduct: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-0",
  ecommerce: "bg-primary/10 text-primary border-0",
  service: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0",
  engagement: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-0",
  launch: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-0",
};

const categoryLabels: Record<string, string> = {
  infoproduct: "Infoproduto",
  ecommerce: "E-commerce",
  service: "Serviço",
  engagement: "Engajamento",
  launch: "Lançamento",
};

const blueprints: AutomationBlueprint[] = [
  {
    id: "ebook",
    name: "Ebook Gratuito",
    description:
      "Envia um ebook gratuito pra quem comenta. Pede pra seguir antes de liberar o link.",
    category: "infoproduct",
    icon: BookOpen,
    custom_message:
      "Oi! Vi que você comentou no meu post sobre o ebook. Segue meu perfil e clica no botão abaixo pra receber!",
    followup_message: "Clica aqui pra receber o ebook 👇",
    quick_replies: [{ title: "Quero o ebook! 📘", payload: "SEND_EBOOK" }],
    buttons: [],
    keyword_filter_enabled: true,
    keywords: ["quero", "ebook", "link", "manda", "eu quero"],
    delay_min_seconds: 30,
    delay_max_seconds: 60,
  },
  {
    id: "cupom",
    name: "Cupom de Desconto",
    description:
      "Envia um cupom exclusivo de desconto pra quem demonstra interesse nos comentários.",
    category: "ecommerce",
    icon: ShoppingCart,
    custom_message: "Ei! Obrigado pelo interesse. Separei um cupom exclusivo pra você!",
    followup_message: "Escolhe uma opção 👇",
    quick_replies: [],
    buttons: [
      { type: "postback", title: "Quero o cupom! 🎟️", payload: "SEND_COUPON" },
      { type: "postback", title: "Ver produtos", payload: "VIEW_PRODUCTS" },
    ],
    keyword_filter_enabled: true,
    keywords: ["cupom", "desconto", "preço", "quanto", "comprar", "quero"],
    delay_min_seconds: 30,
    delay_max_seconds: 90,
  },
  {
    id: "consultoria",
    name: "Consultoria Gratuita",
    description: "Oferece uma consultoria gratuita pra leads qualificados que comentam nos posts.",
    category: "service",
    icon: Briefcase,
    custom_message:
      "Oi! Vi seu comentário e quero te oferecer uma consultoria gratuita de 15 minutos pra te ajudar!",
    followup_message: "Quer agendar? 👇",
    quick_replies: [{ title: "Agendar agora! 📅", payload: "SCHEDULE_CALL" }],
    buttons: [],
    keyword_filter_enabled: false,
    keywords: [],
    delay_min_seconds: 30,
    delay_max_seconds: 60,
  },
  {
    id: "lista-vip",
    name: "Lista VIP",
    description: "Adiciona seguidores engajados numa lista VIP pra receber conteúdos exclusivos.",
    category: "engagement",
    icon: Users,
    custom_message:
      "Que bom que você se interessou! Vou te adicionar na nossa lista VIP pra receber conteúdos exclusivos antes de todo mundo.",
    followup_message: "Confirma sua entrada 👇",
    quick_replies: [
      { title: "Entrar na VIP! ⭐", payload: "JOIN_VIP" },
      { title: "Saber mais", payload: "MORE_INFO" },
    ],
    buttons: [],
    keyword_filter_enabled: true,
    keywords: ["vip", "quero", "entrar", "lista", "exclusivo"],
    delay_min_seconds: 30,
    delay_max_seconds: 45,
  },
  {
    id: "lancamento",
    name: "Pré-Lançamento",
    description: "Captura leads interessados no lançamento de um novo produto ou serviço.",
    category: "launch",
    icon: Megaphone,
    custom_message:
      "Você está entre os primeiros a saber! Estamos lançando algo novo e quero que você tenha acesso antecipado.",
    followup_message: "Garanta sua vaga 👇",
    quick_replies: [],
    buttons: [
      { type: "postback", title: "Quero acesso! 🚀", payload: "EARLY_ACCESS" },
      { type: "postback", title: "Me avise!", payload: "NOTIFY_ME" },
    ],
    keyword_filter_enabled: true,
    keywords: ["quero", "lançamento", "quando", "novidade"],
    delay_min_seconds: 30,
    delay_max_seconds: 60,
  },
  {
    id: "aula",
    name: "Aula Gratuita",
    description: "Convida quem comenta pra assistir uma aula gratuita sobre o tema do post.",
    category: "infoproduct",
    icon: Sparkles,
    custom_message:
      "Oi! Tenho uma aula gratuita sobre esse assunto que pode te ajudar muito. Quer assistir?",
    followup_message: "Clica pra assistir 👇",
    quick_replies: [{ title: "Assistir agora! 🎬", payload: "WATCH_CLASS" }],
    buttons: [],
    keyword_filter_enabled: true,
    keywords: ["aula", "quero", "assistir", "link", "como"],
    delay_min_seconds: 30,
    delay_max_seconds: 60,
  },
  {
    id: "obrigado",
    name: "Engajamento Geral",
    description:
      "Responde a todos os comentários agradecendo e incentivando o follow. Sem filtro de keywords.",
    category: "engagement",
    icon: Heart,
    custom_message:
      "Oi! Obrigado pelo comentário no meu post! Fico feliz que tenha gostado. Me segue pra receber mais conteúdos como esse!",
    followup_message: "",
    quick_replies: [],
    buttons: [],
    keyword_filter_enabled: false,
    keywords: [],
    delay_min_seconds: 30,
    delay_max_seconds: 120,
  },
  {
    id: "brinde",
    name: "Brinde / Sorteio",
    description: "Cadastra participantes de um sorteio ou brinde a partir dos comentários.",
    category: "ecommerce",
    icon: Gift,
    custom_message:
      "Você está participando! Pra confirmar sua participação no sorteio, clica no botão abaixo.",
    followup_message: "Confirma sua participação 👇",
    quick_replies: [{ title: "Participar! 🎁", payload: "ENTER_GIVEAWAY" }],
    buttons: [],
    keyword_filter_enabled: true,
    keywords: ["quero", "participar", "eu", "sorteio"],
    delay_min_seconds: 30,
    delay_max_seconds: 45,
  },
];

function TemplatesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [importingId, setImportingId] = useState<string | null>(null);

  const importM = useMutation({
    mutationFn: (bp: AutomationBlueprint) =>
      createAutomation({
        data: {
          name: bp.name,
          instagram_post_id: "*",
          instagram_post_type: "post",
          custom_message: bp.custom_message,
          followup_message: bp.followup_message,
          quick_replies: bp.quick_replies,
          buttons: bp.buttons,
          is_active: false,
          keyword_filter_enabled: bp.keyword_filter_enabled,
          keywords: bp.keywords,
          delay_min_seconds: bp.delay_min_seconds,
          delay_max_seconds: bp.delay_max_seconds,
        },
      }),
    onSuccess: (_d, bp) => {
      toast.success(`Template "${bp.name}" importado!`);
      qc.invalidateQueries({ queryKey: ["automations"] });
      setImportingId(null);
      navigate({ to: "/automations" });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setImportingId(null);
    },
  });

  function handleImport(bp: AutomationBlueprint) {
    setImportingId(bp.id);
    importM.mutate(bp);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Modelos prontos de automação. Importe e personalize para o seu perfil.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {blueprints.map((bp) => {
          const Icon = bp.icon;
          const isImporting = importingId === bp.id;

          return (
            <Card key={bp.id} className="flex flex-col shadow-lg transition-all duration-200">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="size-4 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold">{bp.name}</CardTitle>
                      <Badge
                        variant="outline"
                        className={`mt-1 text-[10px] ${categoryStyles[bp.category] ?? ""}`}
                      >
                        {categoryLabels[bp.category] ?? bp.category}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3 pt-0">
                <p className="text-xs leading-relaxed text-muted-foreground flex-1">
                  {bp.description}
                </p>

                <div className="rounded-lg bg-muted/30 p-3 text-xs flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">DM:</span>
                    <span className="truncate">{bp.custom_message.slice(0, 50)}...</span>
                  </div>
                  {bp.quick_replies.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Quick:</span>
                      <span>{bp.quick_replies.map((q) => q.title).join(", ")}</span>
                    </div>
                  )}
                  {bp.buttons.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Botões:</span>
                      <span>{bp.buttons.map((b) => b.title).join(", ")}</span>
                    </div>
                  )}
                  {bp.keyword_filter_enabled && bp.keywords.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Keywords:</span>
                      <span>
                        {bp.keywords.slice(0, 3).join(", ")}
                        {bp.keywords.length > 3 ? ` +${bp.keywords.length - 3}` : ""}
                      </span>
                    </div>
                  )}
                </div>

                <Button
                  onClick={() => handleImport(bp)}
                  disabled={isImporting}
                  className="w-full"
                  size="sm"
                >
                  {isImporting ? (
                    <Loader2 className="size-4 animate-spin mr-1" />
                  ) : (
                    <Download className="size-4 mr-1" />
                  )}
                  Importar como Automação
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
