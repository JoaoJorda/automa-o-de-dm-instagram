import { createFileRoute } from "@tanstack/react-router";

/**
 * API de métricas somente-leitura para o CRM central.
 * Autenticação: Authorization: Bearer <chave criada na aba API>.
 * Nada sensível sai daqui: só e-mail + números agregados.
 */

const RATE_LIMIT = 60; // chamadas por minuto por chave
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(keyId: string): boolean {
  const now = Date.now();
  const list = (hits.get(keyId) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(keyId, list);
  if (hits.size > 500) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  }
  return list.length > RATE_LIMIT;
}

const jsonHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function methodNotAllowed() {
  return new Response(JSON.stringify({ error: "method_not_allowed" }), {
    status: 405,
    headers: { ...jsonHeaders, Allow: "GET" },
  });
}

type Counters = { sent: number; failed: number; clicks: number; today: number };

function emptyCounters(): Counters {
  return { sent: 0, failed: 0, clicks: 0, today: 0 };
}

function shape(c: Counters) {
  const total = c.sent + c.failed;
  return {
    dms_sent: c.sent,
    button_clicks: c.clicks,
    ctr: c.sent === 0 ? null : Number(((c.clicks / c.sent) * 100).toFixed(2)),
    delivery_rate: total === 0 ? null : Number(((c.sent / total) * 100).toFixed(2)),
    replies_today: c.today,
  };
}

export const Route = createFileRoute("/api/public/metrics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

        const { hashApiKey, timingSafeEqualHex, looksLikeApiKey } = await import(
          "@/server/api-keys.server"
        );
        if (!token || !looksLikeApiKey(token)) {
          return json({ error: "unauthorized" }, 401);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const tokenHash = await hashApiKey(token);
        const { data: keyRow, error: keyError } = await supabaseAdmin
          .from("api_keys")
          .select("id,key_hash,revoked_at")
          .eq("key_hash", tokenHash)
          .maybeSingle();
        if (keyError) return json({ error: "internal_error" }, 500);
        if (
          !keyRow ||
          keyRow.revoked_at ||
          !timingSafeEqualHex(keyRow.key_hash as string, tokenHash)
        ) {
          return json({ error: "unauthorized" }, 401);
        }

        if (rateLimited(keyRow.id as string)) {
          return new Response(JSON.stringify({ error: "rate_limited" }), {
            status: 429,
            headers: { ...jsonHeaders, "Retry-After": "60" },
          });
        }

        // Params opcionais.
        const url = new URL(request.url);
        const rawTz = Number(url.searchParams.get("tzOffset") ?? 0);
        const tzOffset = Number.isFinite(rawTz) ? Math.max(-840, Math.min(840, Math.trunc(rawTz))) : 0;
        const userFilter = url.searchParams.get("userId");
        if (userFilter && !/^[0-9a-f-]{36}$/i.test(userFilter)) {
          return json({ error: "invalid_user_id" }, 400);
        }

        // "Hoje" = meia-noite no fuso pedido pelo CRM (mesma lógica do painel).
        const offsetMs = tzOffset * 60_000;
        const localClock = new Date(Date.now() - offsetMs);
        localClock.setUTCHours(0, 0, 0, 0);
        const startOfDayUtc = new Date(localClock.getTime() + offsetMs).toISOString();

        const applyUser = <T extends { eq: (c: string, v: string) => T }>(q: T, col: string) =>
          userFilter ? q.eq(col, userFilter) : q;

        const [automationsRes, flowsRes, logsRes, profilesRes] = await Promise.all([
          applyUser(
            supabaseAdmin.from("automations").select("user_id,total_sent,total_failed,total_clicks"),
            "user_id",
          ),
          applyUser(
            supabaseAdmin.from("flows").select("user_id,total_sent,total_failed,total_clicks"),
            "user_id",
          ),
          applyUser(
            supabaseAdmin
              .from("automation_logs")
              .select("user_id")
              .eq("status", "sent")
              .gte("created_at", startOfDayUtc),
            "user_id",
          ),
          applyUser(supabaseAdmin.from("profiles").select("id,email"), "id"),
        ]);

        for (const r of [automationsRes, flowsRes, logsRes, profilesRes]) {
          if (r.error) return json({ error: "internal_error" }, 500);
        }

        const perUser = new Map<string, Counters>();
        const bump = (uid: string) => {
          let c = perUser.get(uid);
          if (!c) {
            c = emptyCounters();
            perUser.set(uid, c);
          }
          return c;
        };

        for (const row of [...(automationsRes.data ?? []), ...(flowsRes.data ?? [])]) {
          const c = bump(row.user_id as string);
          c.sent += row.total_sent ?? 0;
          c.failed += row.total_failed ?? 0;
          c.clicks += row.total_clicks ?? 0;
        }
        for (const row of logsRes.data ?? []) {
          bump(row.user_id as string).today += 1;
        }

        const totals = emptyCounters();
        for (const c of perUser.values()) {
          totals.sent += c.sent;
          totals.failed += c.failed;
          totals.clicks += c.clicks;
          totals.today += c.today;
        }

        const emailById = new Map(
          (profilesRes.data ?? []).map((p) => [p.id as string, p.email as string]),
        );
        const users = [...perUser.entries()]
          .map(([userId, c]) => ({
            user_id: userId,
            email: emailById.get(userId) ?? null,
            ...shape(c),
          }))
          .sort((a, b) => b.dms_sent - a.dms_sent);

        // Atualiza o último uso da chave (best-effort).
        void supabaseAdmin
          .from("api_keys")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", keyRow.id as string);

        return json({
          system: "InstaDesbloqMe",
          generated_at: new Date().toISOString(),
          timezone_offset_minutes: tzOffset,
          totals: { ...shape(totals), users_count: perUser.size },
          users,
        });
      },
      POST: async () => methodNotAllowed(),
      PUT: async () => methodNotAllowed(),
      PATCH: async () => methodNotAllowed(),
      DELETE: async () => methodNotAllowed(),
    },
  },
});
