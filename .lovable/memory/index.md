# Project Memory

## Core

Webhooks externos exigem domínio publicado; URLs de preview (`*.lovableproject.com`, `id-preview--*`) não são acessíveis externamente. URL pública é cacheada em `user_settings.published_origin` na primeira visita ao app publicado.

## Memories

- [Webhook URL](mem://constraints/webhook-url.md) — Detecção via Host + cache em `published_origin`; botão de refresh + avisos na UI de Configurações.
