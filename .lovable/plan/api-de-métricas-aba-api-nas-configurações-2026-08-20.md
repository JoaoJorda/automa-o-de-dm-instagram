# API de métricas + aba "API" nas Configurações

Duas partes: uma "portinha" só de leitura para o CRM central buscar os números, e uma aba nova em Configurações onde você cria e revoga as chaves dessa porta.

## Aba "API" em Configurações

A tela de Configurações passa a ter abas: **Geral** (tudo que já existe hoje) e **API**.

Na aba API você pode:

- Ver a URL fixa da API pra colar no CRM, com botão de copiar.
- Criar uma chave nova dando um nome (ex.: "CRM principal"). A chave completa aparece **uma única vez**, numa caixa com botão de copiar e um aviso: guarde agora, depois não dá pra ver de novo.
- Ver a lista de chaves criadas: nome, prefixo (ex.: `idm_a1b2…`), data de criação, último uso.
- Revogar (apagar) uma chave a qualquer momento — o CRM que usava aquela chave para de conseguir entrar na hora.
- Ver um exemplo pronto de chamada (curl) com o cabeçalho correto.

Cada chave criada dá acesso aos números gerais + a lista de todos os usuários (foi o alcance escolhido).

## O que a API devolve

Um único endereço (`GET`) que responde com:

- Totais gerais do sistema:
  - DMs enviadas
  - Cliques em botões (e o CTR calculado)
  - Taxa de entrega (%)
  - Respostas hoje
- Lista por usuário, com os mesmos 4 números para cada conta (identificada por e-mail e id).

Os cálculos usam exatamente a mesma lógica do painel atual (soma de automações + flows, "hoje" contado a partir da meia-noite; o CRM pode mandar o fuso desejado).

## Segurança

- A chave nunca é guardada por inteiro no banco: fica só um "resumo" irreversível dela (hash SHA-256), como a impressão digital de uma senha. Nem eu nem o banco conseguem reconstruir a chave.
- O CRM envia a chave no cabeçalho `Authorization: Bearer <chave>`; sem ela, errada ou revogada → `401`.
- Comparação "à prova de cronômetro" (timing-safe), pra ninguém adivinhar a chave medindo tempo de resposta.
- Só `GET` é aceito; qualquer outro método recebe `405`.
- Limite simples de chamadas por minuto por chave, pra evitar abuso.
- Resposta marcada como `Cache-Control: no-store`, pra nenhum intermediário guardar dados de conta.
- Nenhum dado sensível sai: sem chave da Zernio, sem texto de mensagens, sem tokens de webhook. Só e-mail + números.
- Criar/listar/revogar chaves exige estar logado; cada usuário só mexe nas próprias chaves (RLS).

## Detalhes técnicos

- **Migração nova**: tabela `public.api_keys` (`id`, `user_id`, `name`, `key_hash` unique, `key_prefix`, `last_used_at`, `revoked_at`, `created_at`), com `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated` + `GRANT ALL ... TO service_role`, RLS ligada e políticas escopadas em `auth.uid()`. Sem acesso `anon`.
- **Server functions** em `src/functions/api-keys.functions.ts` com `requireSupabaseAuth`: `listApiKeys`, `createApiKey` (gera 32 bytes aleatórios → `idm_<base64url>`, guarda só o hash, devolve o valor cru uma vez), `revokeApiKey`.
- **Rota** `src/routes/api/public/metrics.ts` (`createFileRoute` + `server.handlers.GET`). Prefixo `api/public` porque o chamador é externo; toda a autenticação acontece dentro do handler: hash do bearer recebido → busca em `api_keys` (não revogada) → atualiza `last_used_at`.
- Leitura via `supabaseAdmin` (`@/integrations/supabase/client.server`), importado dinamicamente dentro do handler, só depois de validar a chave.
- Query params opcionais validados com Zod: `tzOffset` (minutos, -840..840) e `userId` (uuid) pra filtrar um usuário.
- Rate limit em memória por instância (janela deslizante simples).
- **UI**: `src/routes/_dashboard.settings.tsx` ganha `Tabs` (shadcn) envolvendo o conteúdo atual em "Geral" e um novo componente `src/components/api-keys-panel.tsx` na aba "API".

## Depois de pronto

Te entrego o passo a passo pra colar no CRM: URL estável (`https://project--<id>.lovable.app/api/public/metrics`), formato exato do JSON e o cabeçalho de autenticação — usando a chave que você mesmo criar na aba API.
