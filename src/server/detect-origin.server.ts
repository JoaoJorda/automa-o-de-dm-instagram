import { getRequestHeader, getRequestHost } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Hosts de preview/dev que nunca servem como URL pública de webhook. */
export function isPreviewHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
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

/** Origem pública da requisição atual, ou null se preview/dev. */
export function detectPublicAppOrigin(): string | null {
  try {
    const forwardedHost = getRequestHeader("x-forwarded-host");
    const host = forwardedHost || getRequestHost();
    if (!host) return null;
    const hostname = host.split(":")[0];
    if (isPreviewHostname(hostname)) return null;
    const proto = getRequestHeader("x-forwarded-proto") || "https";
    return `${proto}://${host}`;
  } catch {
    return null;
  }
}

/**
 * Detecta a URL pública do app a partir do header Host e persiste em
 * user_settings.published_origin. Silencioso — nunca quebra a server function.
 * URL definida manualmente pelo usuário (origin_is_manual) tem precedência e
 * não é sobrescrita. Retorna a origem efetiva (ou null).
 */
export async function detectAndPersistPublicOrigin(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  try {
    const detected = detectPublicAppOrigin();

    const { data: existing, error: selectError } = await supabase
      .from("user_settings")
      .select("published_origin,origin_is_manual")
      .eq("user_id", userId)
      .maybeSingle();
    if (selectError) {
      console.error("[origin] leitura de user_settings falhou:", selectError.message);
      return null;
    }

    const row = existing as {
      published_origin?: string | null;
      origin_is_manual?: boolean | null;
    } | null;

    // URL manual vence a detecção — não sobrescreve.
    if (row?.origin_is_manual && row.published_origin) return row.published_origin;

    if (!detected) return null;

    const stored = row?.published_origin ?? null;
    if (detected !== stored) {
      const { error: updateError } = await supabase
        .from("user_settings")
        .update({ published_origin: detected })
        .eq("user_id", userId);
      if (updateError) {
        console.error("[origin] persistência de published_origin falhou:", updateError.message);
        return null;
      }
    }
    return detected;
  } catch (error) {
    console.error(
      "[origin] detecção/persistência falhou:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * Verificação end-to-end da URL do webhook: o handler GET da rota ecoa
 * hub.challenge quando o token existe. Prova que a origem aponta pra ESTE app
 * e que o token está ativo. Best-effort — fetch do próprio domínio pode ser
 * bloqueado em alguns ambientes de edge, então falha vira aviso, não erro.
 */
export async function verifyWebhookEndpoint(
  origin: string,
  webhookToken: string,
): Promise<boolean> {
  const challenge = `insta-reply-check-${Date.now()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      `${origin}/api/webhooks/zernio/${webhookToken}?hub.challenge=${challenge}`,
      { method: "GET", signal: controller.signal },
    );
    if (!res.ok) return false;
    return (await res.text()) === challenge;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
