// Server-only: cliente HTTP da Zernio.
// Endpoints validados conforme documentação oficial fornecida pelo suporte da Zernio.
const ZERNIO_BASE = process.env.ZERNIO_API_BASE || "https://zernio.com/api/v1";

interface ZernioFetchOpts {
  apiKey: string;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
}

async function zernioFetch<T>({
  apiKey,
  path,
  method = "GET",
  body,
  timeoutMs = 5000,
}: ZernioFetchOpts): Promise<T> {
  // Timeout configurável. O webhook processa SÍNCRONO (waitUntil não sobrevive
  // no CF Worker), então o orçamento total precisa caber no timeout ~10s da
  // Zernio. Nas medições reais as chamadas completam em <2s — os caps são rede:
  // - findConversation: 3s | /accounts: 5s (default)
  // - private-reply / sendConversationMessage: 4s
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${ZERNIO_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`Zernio API timeout (>${timeoutMs}ms) em ${path}`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Zernio API ${res.status}: ${text || res.statusText}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

interface ZernioAccount {
  _id: string;
  platform: string;
  username: string;
  isActive?: boolean;
}

export async function zernioGetInstagramAccount(
  apiKey: string,
): Promise<{ accountId: string | null; username: string | null }> {
  try {
    const data = await zernioFetch<{ accounts?: ZernioAccount[] }>({
      apiKey,
      path: "/accounts",
    });
    console.log("[zernio] /accounts response:", JSON.stringify(data));
    const instagramAccounts = (data.accounts ?? []).filter((a) => a.platform === "instagram");
    // Em workspaces com contas antigas/desconectadas, usar a primeira entrada
    // podia persistir um accountId inativo. Prefere explicitamente a ativa,
    // mas NUNCA trava a conexão: sem conta ativa (ou isActive null/ausente),
    // cai pra primeira conta Instagram — comportamento que já funcionava.
    const ig = instagramAccounts.find((a) => a.isActive === true) ?? instagramAccounts[0];
    if (!ig) return { accountId: null, username: null };
    return { accountId: ig._id, username: ig.username };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[zernio] /accounts failed:", msg);
    throw new Error(`Falha ao consultar Zernio (/accounts): ${msg}`);
  }
}

// 1ª mensagem: Private reply ao comentário (não precisa janela de 24h, text only)
export async function zernioSendPrivateReply(input: {
  apiKey: string;
  accountId: string;
  postId: string;
  commentId: string;
  message: string;
}): Promise<{ messageId?: string }> {
  return zernioFetch({
    apiKey: input.apiKey,
    path: `/inbox/comments/${encodeURIComponent(input.postId)}/${encodeURIComponent(input.commentId)}/private-reply`,
    method: "POST",
    body: {
      accountId: input.accountId,
      message: input.message,
    },
    timeoutMs: 4000,
  });
}

interface ZernioConversation {
  _id?: string;
  id?: string;
  participantId?: string;
  participants?: Array<{ id?: string; platformUserId?: string }>;
}

export async function zernioFindConversationId(input: {
  apiKey: string;
  accountId: string;
  participantId: string;
}): Promise<string | null> {
  try {
    // Zernio retorna { data: [...] }, não { conversations: [...] }.
    // Cada conversation tem id (flat) e participantId (flat) no top-level.
    const data = await zernioFetch<{
      data?: ZernioConversation[];
      conversations?: ZernioConversation[];
    }>({
      apiKey: input.apiKey,
      path: `/inbox/conversations?accountId=${encodeURIComponent(input.accountId)}`,
      timeoutMs: 3000,
    });
    const list = data.data ?? data.conversations ?? [];
    const conv = list.find((c) => {
      if (c.participantId === input.participantId) return true;
      return (c.participants ?? []).some(
        (p) => p.id === input.participantId || p.platformUserId === input.participantId,
      );
    });
    return conv?.id || conv?._id || null;
  } catch (e) {
    console.error("[zernio] /inbox/conversations failed:", e);
    return null;
  }
}

// 2ª mensagem: Follow-up via conversation (precisa janela de 24h aberta)
//
// Formato validado (confirmado pelo Elean do suporte Zernio, 2026-04-22):
//
// - `message`: string sempre no root
// - `quickReplies`: array no root (até 13) — {title, payload}
// - `template`: objeto no root pra botões web_url/postback
//     { type: "generic", elements: [{title, subtitle?, buttons: [...]}] }
//     buttons[].type = "url" (Zernio traduz pra web_url internamente) ou "postback"
//
// Dentro de 24h o Meta trata como RESPONSE por default — não precisa messagingType.
export async function zernioSendConversationMessage(input: {
  apiKey: string;
  accountId: string;
  conversationId: string;
  message: string;
  quickReplies?: { title: string; payload: string }[];
  buttons?: { type: string; title: string; payload?: string; url?: string }[];
  templateTitle?: string;
  templateSubtitle?: string;
  useHumanAgentTag?: boolean;
}): Promise<{ messageId?: string }> {
  const body: Record<string, unknown> = {
    accountId: input.accountId,
    message: input.message || "👇",
  };

  if (input.quickReplies && input.quickReplies.length > 0) {
    body.quickReplies = input.quickReplies.slice(0, 13);
  }

  if (input.buttons && input.buttons.length > 0) {
    const mappedButtons = input.buttons.slice(0, 3).map((b) => {
      // No contrato da Zernio: "url" pra link externo (eles traduzem pra web_url
      // internamente antes de mandar pro Meta). "web_url" direto falha com 400.
      if (b.type === "web_url" || b.type === "url") {
        return { type: "url", title: b.title, url: b.url ?? "" };
      }
      return { type: "postback", title: b.title, payload: b.payload ?? b.title };
    });

    body.template = {
      type: "generic",
      elements: [
        {
          title: input.templateTitle || input.message || "👇",
          subtitle: input.templateSubtitle,
          buttons: mappedButtons,
        },
      ],
    };
  }

  if (input.useHumanAgentTag) {
    body.messagingType = "MESSAGE_TAG";
    body.messageTag = "HUMAN_AGENT";
  }

  return zernioFetch({
    apiKey: input.apiKey,
    path: `/inbox/conversations/${encodeURIComponent(input.conversationId)}/messages`,
    method: "POST",
    body,
    timeoutMs: 4000,
  });
}
