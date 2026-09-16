# Rebrand: InstaReply → InstaDesbloqMe (identidade DesbloqME)

## 1. Novo nome em todo o sistema

Trocar "InstaReply" / "Insta Reply" por **InstaDesbloqMe** nos pontos onde o nome aparece:

- `src/routes/_dashboard.tsx` — logo da sidebar e título mobile do header
- `src/routes/login.tsx` — marca nas duas colunas da tela de login
- `src/routes/__root.tsx` — `title`, `og:title` e descrição do site
- `src/routes/_dashboard.help.tsx` — todas as menções no texto da Ajuda
- `src/styles.css` — comentários das paletas
- `CLAUDE.md` — cabeçalho e descrição do projeto

Não muda: a variável de ambiente `INSTAREPLY_ENCRYPTION_KEY` (`src/server/crypto.server.ts`, `.env.example`). Renomear quebraria a chave de criptografia já usada em produção — fica como está.

## 2. Paleta DesbloqME

Referência: Dourado `#C19714`, Grafite `#1A1A1A`, Branco, Cinza `#6E6E6E`, tipografia **Poppins**.

Reescrever os tokens em `src/styles.css` mantendo o formato `oklch` e a estrutura atual (`:root` claro + `.dark`):

**Claro (Branco + Dourado)**
- background branco, card `#FAFAFA`, foreground grafite
- `--primary` dourado `oklch(0.66 0.115 88)`, primary-foreground branco
- `--secondary` grafite, `--accent` dourado, muted cinza claro
- border/input cinza `oklch(0.9 0 0)`, ring dourado
- sidebar branca com foreground cinza-escuro e primary/ring dourados

**Escuro (Grafite + Dourado)**
- background `oklch(0.2 0 0)` (grafite), card levemente mais claro
- `--primary` dourado mais claro `oklch(0.76 0.115 88)` pra contraste
- muted/border em cinzas neutros, sem azul
- sidebar grafite, accent dourado

Ajustes de componentes que hoje assumem azul:
- `src/routes/_dashboard.tsx`: gradiente do logo `from-primary to-sky-300` → gradiente dourado baseado em tokens (primary → accent)
- Varredura por classes `sky-*`/`blue-*` remanescentes e troca por tokens semânticos

## 3. Tipografia Poppins

Carregar Poppins via `<link>` no `<head>` de `src/routes/__root.tsx` (não via `@import` no CSS, restrição do Tailwind v4) e definir `--font-sans: Poppins, ...` no `@theme` de `src/styles.css`, para headings e corpo.

## Validação

1. Sidebar, botões e estados ativos aparecem dourados no claro e no escuro.
2. Nome "InstaDesbloqMe" na sidebar, login, header mobile, aba do navegador e Ajuda.
3. Fonte Poppins aplicada em títulos e corpo.
4. Nenhum resquício azul (sky/blue) na interface.

## Arquivos alterados

`src/styles.css`, `src/routes/__root.tsx`, `src/routes/_dashboard.tsx`, `src/routes/login.tsx`, `src/routes/_dashboard.help.tsx`, `CLAUDE.md`

Sem mudanças de banco, sem novas dependências.
