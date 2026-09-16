import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { detectAndPersistPublicOrigin } from "@/server/detect-origin.server";

export interface AutomationInput {
  id?: string;
  name: string;
  instagram_post_id: string;
  instagram_post_type: string;
  custom_message: string;
  followup_message: string;
  quick_replies: { title: string; payload: string }[];
  buttons: { type: string; title: string; payload?: string; url?: string }[];
  is_active: boolean;
  keyword_filter_enabled: boolean;
  keywords: string[];
  delay_min_seconds: number;
  delay_max_seconds: number;
  trigger_on_dm?: boolean;
  require_follow?: boolean;
  follower_gate_message?: string;
}

function slugify(text: string, fallback: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug || `${fallback}_${Date.now().toString(36).toUpperCase()}`;
}

const QR_PREFIX_RE = /^qr:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:/i;

/**
 * Namespacia payloads com `qr:<automationId>:<slug>`. O prefixo com o id
 * elimina colisão entre automações com botões de mesmo título/payload (o
 * webhook resolve o dono pelo id) e o clique nunca entrega a campanha errada.
 *
 * - CREATE (rewriteAll): reescreve TODOS os payloads postback — não existe
 *   clique pendente pra preservar, e templates mandam payloads hardcoded
 *   (SEND_EBOOK etc.) que colidiriam entre imports.
 * - UPDATE: só preenche vazios — payload já publicado num botão do Instagram
 *   precisa continuar resolvendo.
 */
function fillPayloads(
  automationId: string,
  data: AutomationInput,
  opts: { rewriteAll?: boolean } = {},
): AutomationInput {
  const prefix = `qr:${automationId}:`;
  const namespaced = (payload: string | undefined, title: string, fallback: string): string => {
    const base = (payload ?? "").replace(QR_PREFIX_RE, "") || slugify(title, fallback);
    return `${prefix}${base}`;
  };
  return {
    ...data,
    quick_replies: data.quick_replies.map((q) =>
      q.payload && !opts.rewriteAll ? q : { ...q, payload: namespaced(q.payload, q.title, "QR") },
    ),
    buttons: data.buttons.map((b) =>
      b.type !== "postback" || (b.payload && !opts.rewriteAll)
        ? b
        : { ...b, payload: namespaced(b.payload, b.title, "BTN") },
    ),
  };
}

function validate(input: AutomationInput): AutomationInput {
  if (!input.name?.trim() || input.name.length > 200) throw new Error("Nome inválido");
  if (!input.instagram_post_id?.trim()) throw new Error("Post ID é obrigatório");
  // Automação "somente follow-up" (sem private reply) é suportada — o que não
  // pode é não ter NENHUMA mensagem pra enviar.
  if (!input.custom_message?.trim() && !input.followup_message?.trim()) {
    throw new Error("Preencha a mensagem da DM ou a mensagem de follow-up.");
  }
  const min = Math.max(30, Math.min(120, input.delay_min_seconds || 30));
  const max = Math.max(min, Math.min(120, input.delay_max_seconds || 60));
  const keywords = (input.keywords || []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (input.is_active && input.keyword_filter_enabled && keywords.length === 0) {
    throw new Error("Informe ao menos uma palavra-chave ou desative o filtro.");
  }
  const quickReplies = (input.quick_replies || [])
    .slice(0, 13)
    .map((reply) => ({ ...reply, title: (reply.title ?? "").trim() }));
  const buttons = (input.buttons || []).slice(0, 3).map((button) => ({
    ...button,
    title: (button.title ?? "").trim(),
    url: button.url?.trim(),
  }));
  if (quickReplies.some((reply) => !reply.title?.trim() || reply.title.length > 20)) {
    throw new Error("Quick replies precisam de título com até 20 caracteres.");
  }
  for (const button of buttons) {
    if (!button.title?.trim() || button.title.length > 20) {
      throw new Error("Botões precisam de título com até 20 caracteres.");
    }
    if (button.type !== "postback" && button.type !== "web_url") {
      throw new Error("Tipo de botão inválido.");
    }
    if (button.type === "web_url") {
      try {
        const url = new URL(button.url ?? "");
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
      } catch {
        throw new Error(`Botão "${button.title}": URL inválida.`);
      }
    }
  }

  return {
    ...input,
    name: input.name.trim(),
    instagram_post_id: input.instagram_post_id.trim(),
    custom_message: input.custom_message ?? "",
    followup_message: input.followup_message ?? "",
    delay_min_seconds: min,
    delay_max_seconds: max,
    quick_replies: quickReplies,
    buttons,
    keywords,
    require_follow: !!input.require_follow,
    follower_gate_message: (input.follower_gate_message ?? "").trim().slice(0, 500),
  };
}

export const listAutomations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await detectAndPersistPublicOrigin(supabase, userId);
    const { data, error } = await supabase
      .from("automations")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { automations: data ?? [] };
  });

export const createAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AutomationInput) => validate(input))
  .handler(async ({ data: rawData, context }) => {
    const { supabase, userId } = context;
    // Id gerado aqui pra prefixar os payloads dos botões antes do insert.
    const automationId = crypto.randomUUID();
    const data = fillPayloads(automationId, rawData, { rewriteAll: true });
    const { data: row, error } = await supabase
      .from("automations")
      .insert({
        id: automationId,
        user_id: userId,
        name: data.name,
        instagram_post_id: data.instagram_post_id,
        instagram_post_type: data.instagram_post_type,
        custom_message: data.custom_message,
        followup_message: data.followup_message,
        quick_replies: data.quick_replies,
        buttons: data.buttons,
        is_active: data.is_active,
        keyword_filter_enabled: data.keyword_filter_enabled,
        keywords: data.keywords,
        delay_min_seconds: data.delay_min_seconds,
        delay_max_seconds: data.delay_max_seconds,
        trigger_on_dm: data.trigger_on_dm ?? false,
        require_follow: data.require_follow ?? false,
        follower_gate_message: data.follower_gate_message || null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { automation: row };
  });

export const getAutomation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("automations")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Automação não encontrada");
    return { automation: row };
  });

export const updateAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AutomationInput & { id: string }) => ({
    ...validate(input),
    id: input.id,
  }))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { id, ...restRaw } = data;
    const rest = fillPayloads(id, restRaw);

    const { data: row, error } = await supabase
      .from("automations")
      .update({
        name: rest.name,
        instagram_post_id: rest.instagram_post_id,
        instagram_post_type: rest.instagram_post_type,
        custom_message: rest.custom_message ?? "",
        followup_message: rest.followup_message ?? "",
        quick_replies: rest.quick_replies,
        buttons: rest.buttons,
        is_active: rest.is_active,
        keyword_filter_enabled: rest.keyword_filter_enabled,
        keywords: rest.keywords,
        delay_min_seconds: rest.delay_min_seconds,
        delay_max_seconds: rest.delay_max_seconds,
        trigger_on_dm: rest.trigger_on_dm ?? false,
        require_follow: rest.require_follow ?? false,
        follower_gate_message: rest.follower_gate_message || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { automation: row };
  });

export const toggleAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; is_active: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    if (data.is_active) {
      const { data: row, error: readError } = await supabase
        .from("automations")
        .select("custom_message,followup_message,keyword_filter_enabled,keywords")
        .eq("id", data.id)
        .maybeSingle();
      if (readError) throw new Error(readError.message);
      if (!row) throw new Error("Automação não encontrada");
      if (!row.custom_message.trim() && !(row.followup_message ?? "").trim()) {
        throw new Error("Preencha a mensagem da DM ou a mensagem de follow-up.");
      }
      if (row.keyword_filter_enabled && row.keywords.length === 0) {
        throw new Error("Informe ao menos uma palavra-chave ou desative o filtro.");
      }
    }
    const { data: changed, error } = await supabase
      .from("automations")
      .update({ is_active: data.is_active })
      .eq("id", data.id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!changed || changed.length === 0) throw new Error("Automação não encontrada");
    return { success: true };
  });

export const deleteAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: deleted, error } = await supabase
      .from("automations")
      .delete()
      .eq("id", data.id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!deleted || deleted.length === 0) throw new Error("Automação não encontrada");
    return { success: true };
  });
