# nascent-wonder-code — InstaDesbloqMe (Automação de DM Instagram)

Remix "[Remix] - InstaDesbloqMe" — automação de respostas de DM do Instagram. TanStack Start TS + Tailwind + shadcn/Radix + Supabase (pasta `supabase/`), gitsync ativo com o Lovable.

## Lovable (MCP claude_ai_Lovable)

- **project_id**: `701ac288-346e-48c2-b75d-5a7ecf62b9a4` — SEMPRE passar explícito nas chamadas MCP
- **workspace**: VIVER DE IA Team Workspace (`4CscjTfdP3u4Xba0i5P3`)
- Editor: https://lovable.dev/projects/701ac288-346e-48c2-b75d-5a7ecf62b9a4
- Preview: https://id-preview--701ac288-346e-48c2-b75d-5a7ecf62b9a4.lovable.app
- Publicado: https://nascent-wonder-code.lovable.app

## Fluxo de trabalho

1. Editar código local → commit → push (`main`)
2. Avisar o Lovable via MCP (`send_message` com project_id) para aplicar o commit, deployar edge functions e rodar migrations — eu não enxergo o banco diretamente.

## Comandos

- `bun install` (lockfile é bun.lock) · `bun run dev` · `bun run build` · `bun run lint`
