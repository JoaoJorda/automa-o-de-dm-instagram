// Registro global de middleware do TanStack Start. O attachSupabaseAuth anexa
// o Bearer token do Supabase a TODA chamada de server function no client —
// substitui o antigo withAuthFetch, que monkey-patcheava globalThis.fetch por
// requisição (race entre chamadas concorrentes + vazava o JWT pra qualquer
// fetch disparado durante a janela do patch).
import { createStart } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
}));
