import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { encryptString, decryptAndHeal, SecretUnavailableError } from "@/server/crypto.server";
import { zernioGetInstagramAccount } from "@/server/zernio.server";
import {
  detectAndPersistPublicOrigin,
  detectPublicAppOrigin,
  isPreviewHostname,
  verifyWebhookEndpoint,
} from "@/server/detect-origin.server";

/**
 * Self-heal: o trigger handle_new_user pode ter falhado no signup (visto em
 * remix de cliente) deixando o usuário sem profile/webhook_token — sem isso a
 * URL do webhook nunca é gerada. A RPC (SECURITY DEFINER) recria as rows que
 * faltam e devolve o token. Best-effort: retorna null se a RPC não existir.
 */
async function ensureProfileRow(supabase: SupabaseClient): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("ensure_profile" as never);
    if (error) {
      console.error("[settings] ensure_profile falhou:", error.message);
      return null;
    }
    return typeof data === "string" && data ? data : null;
  } catch {
    return null;
  }
}

export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    let [settingsResult, profileResult] = await Promise.all([
      supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("profiles").select("webhook_token,email,name").eq("id", userId).maybeSingle(),
    ]);
    if (settingsResult.error) throw new Error(settingsResult.error.message);
    if (profileResult.error) throw new Error(profileResult.error.message);
    let settings = settingsResult.data;
    let profile = profileResult.data;

    if (!settings || !profile?.webhook_token) {
      const healedToken = await ensureProfileRow(supabase);
      if (healedToken) {
        [settingsResult, profileResult] = await Promise.all([
          supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
          supabase
            .from("profiles")
            .select("webhook_token,email,name")
            .eq("id", userId)
            .maybeSingle(),
        ]);
        if (settingsResult.error) throw new Error(settingsResult.error.message);
        if (profileResult.error) throw new Error(profileResult.error.message);
        settings = settingsResult.data;
        profile = profileResult.data;
      }
    }

    // Detecção roda DEPOIS do self-heal: o UPDATE interno é no-op silencioso se a
    // row de user_settings ainda não existir — a origem detectada se perderia.
    const detected = await detectAndPersistPublicOrigin(supabase, userId);

    const row = settings as {
      published_origin?: string | null;
      origin_is_manual?: boolean | null;
    } | null;
    const stored = row?.published_origin ?? null;
    const publicAppOrigin = detected ?? stored;

    return {
      publicAppOrigin,
      originIsManual: !!row?.origin_is_manual,
      settings: {
        has_api_key: !!settings?.zernio_api_key_encrypted,
        instagram_username: settings?.instagram_username ?? null,
        instagram_connected: !!settings?.instagram_connected,
        outgoing_webhook_url: settings?.outgoing_webhook_url ?? "",
        outgoing_webhook_enabled: !!settings?.outgoing_webhook_enabled,
      },
      profile: {
        webhook_token: profile?.webhook_token ?? null,
        email: profile?.email ?? null,
        name: profile?.name ?? null,
      },
    };
  });

export const saveZernioApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { apiKey: string }) => {
    const apiKey = input.apiKey.trim();
    if (apiKey.length < 8 || apiKey.length > 500) {
      throw new Error("API Key inválida");
    }
    return { apiKey };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // A chave pode pertencer a outro workspace/Instagram — manter o accountId
    // antigo combinaria credenciais incompatíveis no webhook. Mas re-salvar a
    // MESMA key não pode desconectar: compara antes de derrubar a conexão.
    let keyChanged = true;
    const { data: current, error: currentError } = await supabase
      .from("user_settings")
      .select("zernio_api_key_encrypted")
      .eq("user_id", userId)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);
    if (current?.zernio_api_key_encrypted) {
      try {
        const existing = await decryptAndHeal(current.zernio_api_key_encrypted, async () => {});
        keyChanged = existing !== data.apiKey;
      } catch {
        // Key antiga indecifrável: trate como mudança (reset é o seguro).
      }
    }
    const encrypted = await encryptString(data.apiKey);
    const { error } = await supabase.from("user_settings").upsert(
      keyChanged
        ? {
            user_id: userId,
            zernio_api_key_encrypted: encrypted,
            instagram_connected: false,
            instagram_username: null,
            zernio_account_id: null,
          }
        : { user_id: userId, zernio_api_key_encrypted: encrypted },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { success: true, reconnect_required: keyChanged };
  });

export const connectInstagram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: settings, error: settingsError } = await supabase
      .from("user_settings")
      .select("zernio_api_key_encrypted")
      .eq("user_id", userId)
      .maybeSingle();
    if (settingsError) throw new Error(settingsError.message);
    if (!settings?.zernio_api_key_encrypted) {
      throw new Error("Salve sua API Key da Zernio antes de conectar.");
    }
    const storedCiphertext = settings.zernio_api_key_encrypted;
    const apiKey = await decryptAndHeal(storedCiphertext, async (next) => {
      // CAS no ciphertext original: se o usuário salvou outra key no meio, 0 rows.
      const { error } = await supabase
        .from("user_settings")
        .update({ zernio_api_key_encrypted: next })
        .eq("user_id", userId)
        .eq("zernio_api_key_encrypted", storedCiphertext);
      if (error) throw new Error(error.message);
    });
    const { accountId, username } = await zernioGetInstagramAccount(apiKey);
    if (!accountId || !username) {
      // Não lança: é estado de configuração esperado (sem conta IG na Zernio).
      return {
        username: null,
        error:
          "Nenhuma conta Instagram encontrada na Zernio. Conecte seu Instagram no painel da Zernio e tente de novo.",
      };
    }
    const { error } = await supabase
      .from("user_settings")
      .update({
        instagram_username: username,
        instagram_connected: true,
        zernio_account_id: accountId,
      })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { username, error: null };
  });


export const disconnectInstagram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("user_settings")
      // Limpa também o accountId: o webhook usa key + accountId e não consulta
      // instagram_connected, então preservar o id deixava a automação operante.
      .update({
        instagram_connected: false,
        instagram_username: null,
        zernio_account_id: null,
      })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

/**
 * Redetecta a URL pública a partir da requisição atual e persiste — atômico:
 * se daqui não dá pra detectar (preview/dev), NADA é apagado; a URL anterior
 * (inclusive manual) permanece válida.
 */
export const redetectPublishedOrigin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const origin = detectPublicAppOrigin();
    if (!origin) {
      throw new Error(
        "Não dá pra detectar a URL a partir deste endereço (preview/dev). Abra o app pelo link publicado e clique em Atualizar lá — ou defina a URL manualmente.",
      );
    }
    const { error } = await supabase
      .from("user_settings")
      .upsert(
        { user_id: userId, published_origin: origin, origin_is_manual: false },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { origin };
  });

export const setPublishedOrigin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { url: string }) => {
    const raw = (input.url ?? "").trim();
    if (!raw) throw new Error("Informe a URL do app publicado");
    let parsed: URL;
    try {
      parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      throw new Error("URL inválida — exemplo: https://seuapp.lovable.app");
    }
    if (parsed.protocol !== "https:") throw new Error("A URL precisa ser https://");
    return { origin: parsed.origin, hostname: parsed.hostname };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (isPreviewHostname(data.hostname)) {
      throw new Error(
        "Essa é uma URL de preview do editor — ela muda e não é estável. Publique o app e use a URL publicada.",
      );
    }

    // Garante que existe webhook_token (e a row de user_settings) antes de salvar.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("webhook_token")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);
    let webhookToken = profile?.webhook_token ?? null;
    if (!webhookToken) webhookToken = await ensureProfileRow(supabase);

    const { error } = await supabase
      .from("user_settings")
      .upsert(
        { user_id: userId, published_origin: data.origin, origin_is_manual: true },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);

    // Best-effort: confirma que a URL realmente aponta pra este app.
    const verified = webhookToken ? await verifyWebhookEndpoint(data.origin, webhookToken) : false;

    return { origin: data.origin, verified };
  });

export const saveOutgoingWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { url: string; enabled: boolean }) => {
    const url = input.url.trim();
    if (url.length > 2000) throw new Error("URL muito longa");
    if (input.enabled && !url) throw new Error("Informe a URL antes de ativar o webhook.");
    if (url) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
      } catch {
        throw new Error("URL inválida — use um endereço http:// ou https:// completo.");
      }
    }
    return { ...input, url };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("user_settings").upsert(
      {
        user_id: userId,
        outgoing_webhook_url: data.url || null,
        outgoing_webhook_enabled: data.enabled,
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const testConfiguration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: settings, error: settingsError } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (settingsError) throw new Error(settingsError.message);

    const profileResult = await supabase
      .from("profiles")
      .select("webhook_token")
      .eq("id", userId)
      .maybeSingle();
    if (profileResult.error) throw new Error(profileResult.error.message);
    let profile = profileResult.data;
    if (!profile?.webhook_token) {
      const healed = await ensureProfileRow(supabase);
      if (healed) profile = { webhook_token: healed };
    }

    // Valida que a API key salva consegue ser descriptografada de verdade.
    let apiKeyStatus: "ok" | "fail" = "fail";
    let apiKeyDetail: string | undefined = "API Key não configurada";
    if (settings?.zernio_api_key_encrypted) {
      const storedCiphertext = settings.zernio_api_key_encrypted;
      try {
        // decryptAndHeal migra rows cifradas com segredo legado pro atual.
        const decrypted = await decryptAndHeal(storedCiphertext, async (next) => {
          // CAS no ciphertext original: se o usuário salvou outra key no meio, 0 rows.
          const { error } = await supabase
            .from("user_settings")
            .update({ zernio_api_key_encrypted: next })
            .eq("user_id", userId)
            .eq("zernio_api_key_encrypted", storedCiphertext);
          if (error) throw new Error(error.message);
        });
        if (decrypted && decrypted.length >= 8) {
          apiKeyStatus = "ok";
          apiKeyDetail = undefined;
        } else {
          apiKeyDetail = "API Key inválida — salve novamente.";
        }
      } catch (e) {
        apiKeyDetail =
          e instanceof SecretUnavailableError
            ? "Segredo de criptografia temporariamente indisponível — rode o teste de novo em instantes (a chave salva está intacta)."
            : "Falha ao descriptografar a API Key (segredo do servidor mudou). Salve a chave novamente.";
      }
    }

    return {
      results: [
        { step: "Autenticação", status: "ok" as const },
        { step: "Zernio API Key", status: apiKeyStatus, detail: apiKeyDetail },
        {
          step: "Instagram conectado",
          status: settings?.instagram_connected ? ("ok" as const) : ("fail" as const),
          detail: settings?.instagram_connected
            ? `@${settings.instagram_username}`
            : "Conecte seu Instagram",
        },
        await (async () => {
          if (!profile?.webhook_token) {
            return {
              step: "Webhook endpoint",
              status: "fail" as const,
              detail: "Token do webhook não encontrado — recarregue a página de Configurações.",
            };
          }
          const origin =
            (settings as { published_origin?: string | null } | null)?.published_origin ?? null;
          if (!origin) {
            return {
              step: "Webhook endpoint",
              status: "fail" as const,
              detail:
                "URL pública não configurada — abra o app publicado e faça login, ou cole a URL publicada em Configurações.",
            };
          }
          // Self-fetch pode ser bloqueado em ambientes de edge mesmo com a URL
          // certa (o webhook segue funcionando pra Zernio) — falha vira aviso,
          // não erro, seguindo o contrato de verifyWebhookEndpoint.
          const reachable = await verifyWebhookEndpoint(origin, profile.webhook_token);
          return {
            step: "Webhook endpoint",
            status: reachable ? ("ok" as const) : ("warn" as const),
            detail: reachable
              ? `${origin}/api/webhooks/zernio/… verificado`
              : `URL configurada (${origin}), mas não consegui confirmá-la a partir do servidor — pode ser bloqueio de self-fetch do ambiente. Se a Zernio não entregar eventos, revise a URL.`,
          };
        })(),
      ],
    };
  });
