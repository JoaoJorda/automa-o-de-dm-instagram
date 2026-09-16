import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { detectAndPersistPublicOrigin } from "@/server/detect-origin.server";

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { timezoneOffsetMinutes?: number } | undefined) => {
    // NaN sobrevive a max/min/trunc e estouraria RangeError no toISOString —
    // payload forjado não-numérico cai no default 0 (UTC).
    const raw = Number(input?.timezoneOffsetMinutes ?? 0);
    return {
      timezoneOffsetMinutes: Number.isFinite(raw)
        ? Math.max(-840, Math.min(840, Math.trunc(raw)))
        : 0,
    };
  })
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    // Detectar e persistir URL pública no primeiro acesso ao dashboard via domínio publicado.
    const detectedOrigin = await detectAndPersistPublicOrigin(supabase, userId);

    // created_at está em UTC, mas "hoje" é o dia local do navegador. Sem o
    // offset, usuários do Brasil viam a contagem virar à meia-noite UTC (21h).
    const now = Date.now();
    const offsetMs = data.timezoneOffsetMinutes * 60_000;
    const localClock = new Date(now - offsetMs);
    localClock.setUTCHours(0, 0, 0, 0);
    const startOfLocalDayUtc = new Date(localClock.getTime() + offsetMs);

    const [automationsResult, flowsResult, todayResult, settingsResult] = await Promise.all([
      supabase
        .from("automations")
        .select("is_active,total_sent,total_failed,total_clicks")
        .eq("user_id", userId),
      supabase
        .from("flows")
        .select("is_active,total_sent,total_failed,total_clicks")
        .eq("user_id", userId),
      supabase
        .from("automation_logs")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "sent")
        .gte("created_at", startOfLocalDayUtc.toISOString()),
      supabase
        .from("user_settings")
        .select("zernio_api_key_encrypted,instagram_connected,published_origin")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    for (const result of [automationsResult, flowsResult, todayResult, settingsResult]) {
      if (result.error) throw new Error(result.error.message);
    }
    const automations = automationsResult.data;
    const flows = flowsResult.data;
    const todayCount = todayResult.count;
    const settings = settingsResult.data;

    const all = [...(automations ?? []), ...(flows ?? [])];
    const totalSent = all.reduce((s, a) => s + (a.total_sent ?? 0), 0);
    const totalFailed = all.reduce((s, a) => s + (a.total_failed ?? 0), 0);
    const totalClicks = all.reduce((s, a) => s + (a.total_clicks ?? 0), 0);
    const total = totalSent + totalFailed;
    const deliveryRate = total === 0 ? null : (totalSent / total) * 100;
    const activeAutomations = (automations ?? []).filter((a) => a.is_active).length;
    const activeFlows = (flows ?? []).filter((f) => f.is_active).length;

    return {
      total_sent: totalSent,
      total_clicks: totalClicks,
      ctr: totalSent === 0 ? null : (totalClicks / totalSent) * 100,
      delivery_rate: deliveryRate,
      active_automations: activeAutomations,
      active_flows: activeFlows,
      replies_today: todayCount ?? 0,
      // Checklist de setup — mesmos sinais do diagnóstico em Configurações.
      setup: {
        has_api_key: !!settings?.zernio_api_key_encrypted,
        instagram_connected: !!settings?.instagram_connected,
        has_public_url: !!(detectedOrigin ?? settings?.published_origin),
        has_active_automation: activeAutomations + activeFlows > 0,
      },
    };
  });
