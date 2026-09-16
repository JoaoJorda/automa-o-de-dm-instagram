import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listApiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("api_keys")
      .select("id,name,key_prefix,last_used_at,revoked_at,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { keys: data ?? [] };
  });

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string }) => {
    const name = (input?.name ?? "").trim();
    if (!name) throw new Error("Dê um nome para a chave (ex.: CRM principal).");
    if (name.length > 80) throw new Error("Nome muito longo (máx. 80 caracteres).");
    return { name };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { generateApiKey, hashApiKey } = await import("@/server/api-keys.server");
    const plain = generateApiKey();
    const keyHash = await hashApiKey(plain);
    const { data: row, error } = await supabase
      .from("api_keys")
      .insert({
        user_id: userId,
        name: data.name,
        key_hash: keyHash,
        key_prefix: plain.slice(0, 12),
      })
      .select("id,name,key_prefix,last_used_at,revoked_at,created_at")
      .single();
    if (error) throw new Error(error.message);
    // O valor cru só existe aqui — não é guardado em lugar nenhum.
    return { key: row, plainKey: plain };
  });

export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    const id = (input?.id ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Chave inválida");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("api_keys")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });
