---
name: webhook-url
description: URL pública do webhook detectada automaticamente em qualquer server function autenticada (não só /settings) e cacheada em user_settings.published_origin.
type: constraint
---

URL pública do webhook (`/api/webhooks/zernio/<token>`) deve vir do header Host no servidor — nunca hardcoded, pois projetos remixados têm domínios diferentes.

**Estratégia atual:**

1. Helper compartilhado `src/server/detect-origin.server.ts` → `detectAndPersistPublicOrigin(supabase, userId)`:
   - Lê `x-forwarded-host` / `Host`. Retorna `null` se host é preview (`*.lovableproject.com`, `id-preview--*`, `localhost`).
   - Quando detecta host não-preview, faz upsert em `user_settings.published_origin` (somente se mudou).
   - Silencioso (try/catch) — nunca quebra a server function principal.
2. Chamado em **todas** as server functions de entrada autenticadas:
   - `getDashboardStats` (`dashboard.functions.ts`) — primeira função após login.
   - `listAutomations` (`automations.functions.ts`).
   - `getSettings` (`settings.functions.ts`).
3. `getSettings` retorna `publicAppOrigin = detected ?? stored` (do banco).
4. `clearPublishedOrigin` permite resetar via botão de refresh.

**UI (`_dashboard.settings.tsx`):**

- Aviso amarelo no topo do "Guia de Configuração" pedindo pra publicar primeiro.
- Passo 4 do guia tem campo dedicado pra URL do webhook (sempre visível):
  - Vazio: mensagem amarela "faça login no app publicado uma vez (qualquer página)".
  - Preenchido: URL completa + botão "Copiar".
  - Botão "Detectar"/"Atualizar" sempre visível ao lado.
- Botão "Detectar" verifica `window.location.hostname` no cliente: se está em preview, mostra toast informativo explicando pra abrir pelo link publicado em vez de chamar `clearPublishedOrigin`.
