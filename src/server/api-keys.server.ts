/**
 * Geração e verificação das chaves de API do CRM.
 * A chave crua NUNCA é persistida — só o hash SHA-256 (hex).
 */

const PREFIX = "idm_";

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return PREFIX + toBase64Url(bytes);
}

export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Comparação em tempo constante (timing-safe) entre dois hashes hex. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Formato plausível de chave — evita hash/consulta em lixo. */
export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(PREFIX) && value.length >= 20 && value.length <= 120;
}
