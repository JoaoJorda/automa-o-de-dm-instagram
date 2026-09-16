// Server-only: criptografia da API Key da Zernio usando AES-256-GCM.
//
// Segredo primário: chave aleatória por projeto, gerada uma única vez e
// guardada em public.app_secrets. A tabela não é legível por anon/authenticated
// (as roles alcançáveis pela API REST); service_role e roles de plataforma do
// banco (postgres, sandbox_exec) continuam lendo — a criptografia protege
// contra vazamento da anon key e leitura via RLS, NÃO contra quem já tem
// acesso de editor/owner ao projeto. Como todo runtime que compartilha o banco
// enxerga a mesma chave, remixes e múltiplos deploys convergem sem configurar
// secret manualmente.
//
// INSTAREPLY_ENCRYPTION_KEY (env, opcional) é fallback/candidata:
//   - cifra APENAS quando app_secrets está inacessível;
//   - decifra rows antigas; aceita lista separada por vírgula pra rotação
//     (todas viram candidatas de decrypt; a primeira cifra no fallback).
//   Se usada, precisa do MESMO valor em todo runtime que compartilha o banco.
//
// Segredos legados derivados de valores PÚBLICOS (SUPABASE_URL etc.) só
// decifram rows do código antigo; decryptAndHeal regrava essas rows com a
// chave do projeto (re-encrypt preguiçoso, compare-and-swap no caller).
import crypto from "crypto";

const APP_SECRET_NAME = "zernio_api_key_encryption";

/**
 * Falha de INFRA ao carregar o segredo (banco fora, tabela ausente) — diferente
 * de "chave errada". O webhook trata isso como transiente (pede retry) em vez
 * de instruir o usuário a re-salvar uma chave que está boa.
 */
export class SecretUnavailableError extends Error {
  readonly code = "secret_unavailable";
}

type ProjectSecretState =
  | { status: "ok"; secret: string }
  | { status: "absent" } // sem row e sem erro — genuinamente nunca criada
  | { status: "unavailable" }; // erro de leitura — NÃO dá pra saber

let cachedProjectSecret: string | null = null;

// Leitura pura — o caminho de decrypt nunca cria a chave (criar aqui mascararia
// um "unavailable" transiente como "absent" e apagaria o sinal de erro).
async function readProjectSecret(): Promise<ProjectSecretState> {
  if (cachedProjectSecret) return { status: "ok", secret: cachedProjectSecret };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("app_secrets")
      .select("value")
      .eq("name", APP_SECRET_NAME)
      .maybeSingle();
    if (error) {
      console.error("[crypto] app_secrets select falhou:", error.code, error.message);
      return { status: "unavailable" };
    }
    if (data?.value) {
      cachedProjectSecret = data.value;
      return { status: "ok", secret: data.value };
    }
    return { status: "absent" };
  } catch (e) {
    console.error("[crypto] app_secrets indisponível:", e instanceof Error ? e.message : String(e));
    return { status: "unavailable" };
  }
}

// Cria on-demand — usada só pelo caminho de encrypt.
async function ensureProjectSecret(): Promise<ProjectSecretState> {
  const read = await readProjectSecret();
  if (read.status !== "absent") return read;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const fresh = crypto.randomBytes(32).toString("base64");
    const { error } = await supabaseAdmin
      .from("app_secrets")
      .insert({ name: APP_SECRET_NAME, value: fresh });
    if (!error) {
      cachedProjectSecret = fresh;
      return { status: "ok", secret: fresh };
    }
    // Conflito de PK (corrida na primeira geração) ou falha transiente: relê.
    console.error("[crypto] app_secrets insert falhou:", error.code, error.message);
    const reread = await readProjectSecret();
    return reread.status === "absent" ? { status: "unavailable" } : reread;
  } catch (e) {
    console.error("[crypto] app_secrets indisponível:", e instanceof Error ? e.message : String(e));
    return { status: "unavailable" };
  }
}

function envKeys(): string[] {
  return (process.env.INSTAREPLY_ENCRYPTION_KEY ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function legacySecrets(): string[] {
  const candidates = [
    process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);
  return [...new Set(candidates)];
}

function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

export async function encryptString(plain: string): Promise<string> {
  const project = await ensureProjectSecret();
  let secret: string;
  if (project.status === "ok") {
    secret = project.secret;
  } else if (envKeys().length > 0) {
    secret = envKeys()[0];
  } else {
    throw new SecretUnavailableError(
      project.status === "unavailable"
        ? "Falha ao acessar app_secrets no banco (veja os logs [crypto] do servidor) e INSTAREPLY_ENCRYPTION_KEY não está configurada."
        : "Sem segredo de criptografia: app_secrets não pôde ser criada e INSTAREPLY_ENCRYPTION_KEY não está configurada.",
    );
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export async function decryptWithStatus(
  payload: string,
): Promise<{ plain: string; needsReencrypt: boolean }> {
  const [ivB64, tagB64, encB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !encB64) throw new Error("Invalid encrypted payload");

  const ivBuf = Buffer.from(ivB64, "base64");
  const tagBuf = Buffer.from(tagB64, "base64");
  const encBuf = Buffer.from(encB64, "base64");

  let project = await readProjectSecret();
  if (project.status === "absent") {
    // Ausência CONFIRMADA (≠ "unavailable", que é erro de leitura): cria a
    // chave agora — sem isso, rows legadas decifram pelo candidato antigo com
    // needsReencrypt=false pra sempre e a migração preguiçosa nunca começa.
    project = await ensureProjectSecret();
  }
  const candidates: { secret: string; isPrimary: boolean }[] = [];
  if (project.status === "ok") candidates.push({ secret: project.secret, isPrimary: true });
  for (const secret of [...envKeys(), ...legacySecrets()]) {
    if (!candidates.some((c) => c.secret === secret)) {
      candidates.push({ secret, isPrimary: false });
    }
  }
  if (candidates.length === 0) {
    throw new SecretUnavailableError("Nenhum segredo de criptografia disponível");
  }

  const errors: string[] = [];
  for (const { secret, isPrimary } of candidates) {
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(secret), ivBuf);
      decipher.setAuthTag(tagBuf);
      const dec = Buffer.concat([decipher.update(encBuf), decipher.final()]);
      // Só sinaliza re-encrypt quando o primário FOI carregado — o heal precisa
      // de destino determinístico (a chave do projeto), nunca um fallback.
      return { plain: dec.toString("utf8"), needsReencrypt: !isPrimary && project.status === "ok" };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (project.status === "unavailable") {
    // A chave que provavelmente decifraria esta row não pôde ser LIDA — falha
    // de infra, não de chave. Não instrua o usuário a re-salvar.
    throw new SecretUnavailableError(
      "Segredo do projeto inacessível no banco — tente novamente em instantes.",
    );
  }
  throw new Error(
    `Authentication failed (tried ${candidates.length} secret candidates). Last error: ${errors[errors.length - 1]}`,
  );
}

export async function decryptString(payload: string): Promise<string> {
  return (await decryptWithStatus(payload)).plain;
}

/**
 * Descriptografa e, se a row ainda usa um segredo legado/inferior, regrava com
 * a chave do projeto via `persist`. O persist é best-effort: falhar em regravar
 * não pode falhar a operação principal (o retry acontece no próximo decrypt).
 * O caller DEVE fazer o UPDATE como compare-and-swap no ciphertext original
 * (.eq na coluna cifrada) pra não sobrescrever um save concorrente do usuário,
 * e DEVE lançar quando o supabase-js retornar { error }.
 */
export async function decryptAndHeal(
  payload: string,
  persist: (reencrypted: string) => Promise<void>,
): Promise<string> {
  const { plain, needsReencrypt } = await decryptWithStatus(payload);
  if (needsReencrypt) {
    try {
      await persist(await encryptString(plain));
    } catch (e) {
      console.warn("[crypto] re-encrypt falhou:", e instanceof Error ? e.message : String(e));
    }
  }
  return plain;
}
