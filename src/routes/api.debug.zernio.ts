// Diagnóstico rápido da Zernio: valida API key, conta, e addon Inbox.
// Chamado pela tela de Settings com Bearer token do Supabase.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { decryptString, SecretUnavailableError } from "@/server/crypto.server";

const ZERNIO_BASE = process.env.ZERNIO_API_BASE || "https://zernio.com/api/v1";

interface CheckResult {
  step: string;
  status: "ok" | "fail";
  detail?: string;
}

async function pingZernio(
  apiKey: string,
  path: string,
  timeoutMs = 5000,
): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ZERNIO_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, status: 0, body: `timeout (>${timeoutMs}ms)` };
    }
    return { ok: false, status: 0, body: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timeout);
  }
}

export const Route = createFileRoute("/api/debug/zernio")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        const token = authHeader.replace("Bearer ", "");

        const supabase = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
          },
        );

        const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
        if (claimsError) return Response.json({ error: "unauthorized" }, { status: 401 });
        const userId = claims?.claims?.sub;
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        const { data: settings, error: settingsError } = await supabase
          .from("user_settings")
          .select("zernio_api_key_encrypted,zernio_account_id")
          .eq("user_id", userId)
          .maybeSingle();
        if (settingsError) {
          console.error("[debug/zernio] settings select falhou:", settingsError.message);
          return Response.json({ error: "database_unavailable" }, { status: 503 });
        }

        const results: CheckResult[] = [];

        if (!settings?.zernio_api_key_encrypted) {
          results.push({
            step: "API Key salva",
            status: "fail",
            detail: "Salve sua API Key na seção abaixo.",
          });
          return Response.json({ results });
        }
        results.push({ step: "API Key salva", status: "ok" });

        let apiKey: string;
        try {
          apiKey = await decryptString(settings.zernio_api_key_encrypted);
          results.push({
            step: "API Key descriptografada",
            status: "ok",
            detail: `${apiKey.length} chars`,
          });
        } catch (e) {
          results.push({
            step: "API Key descriptografada",
            status: "fail",
            detail:
              e instanceof SecretUnavailableError
                ? "Segredo de criptografia temporariamente indisponível — rode o diagnóstico de novo em instantes (a chave salva está intacta)."
                : `Falha: ${e instanceof Error ? e.message : String(e)}. Salve a chave novamente.`,
          });
          return Response.json({ results });
        }

        // Check 1: /accounts (valida key + lista contas)
        const accountsRes = await pingZernio(apiKey, "/accounts", 5000);
        if (accountsRes.ok) {
          let accountInfo = "";
          try {
            const parsed = JSON.parse(accountsRes.body) as {
              accounts?: { platform?: string; username?: string }[];
            };
            const ig = parsed.accounts?.find((a) => a.platform === "instagram");
            accountInfo = ig ? `@${ig.username}` : `${parsed.accounts?.length ?? 0} contas`;
          } catch {
            /* ignore */
          }
          results.push({ step: "Zernio /accounts", status: "ok", detail: accountInfo });
        } else {
          results.push({
            step: "Zernio /accounts",
            status: "fail",
            detail: `${accountsRes.status} ${accountsRes.body.slice(0, 200)}`,
          });
        }

        // Check 2: Inbox addon
        if (settings.zernio_account_id) {
          const inboxRes = await pingZernio(
            apiKey,
            `/inbox/conversations?accountId=${encodeURIComponent(settings.zernio_account_id)}&limit=1`,
            5000,
          );
          if (inboxRes.ok) {
            results.push({ step: "Addon Inbox ativo", status: "ok" });
          } else {
            const isInboxRequired =
              inboxRes.body.includes("INBOX_REQUIRED") || inboxRes.status === 403;
            results.push({
              step: "Addon Inbox ativo",
              status: "fail",
              detail: isInboxRequired
                ? "Addon Inbox NÃO está ativo. Ative no painel da Zernio (zernio.com → Configurações → Addons)."
                : `${inboxRes.status} ${inboxRes.body.slice(0, 200)}`,
            });
          }
        } else {
          results.push({
            step: "Addon Inbox ativo",
            status: "fail",
            detail: "Conta Instagram ainda não conectada.",
          });
        }

        return Response.json({ results });
      },
    },
  },
});
