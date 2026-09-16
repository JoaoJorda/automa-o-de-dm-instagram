# Documentação da API em PDF

Gerar um PDF (arquivo para download, não uma página do app) explicando como o CRM central consome a API de métricas do InstaDesbloqMe.

## Conteúdo do documento

1. **Capa** — título "API de Métricas — InstaDesbloqMe", data de geração, identidade visual DesbloqME (dourado #C19714 + grafite #1A1A1A, tipografia limpa).
2. **Visão geral** — para que serve: o CRM central lê os números de DMs enviadas, cliques em botões, taxa de entrega e respostas hoje. Somente leitura.
3. **Como obter a chave** — passo a passo: Configurações → aba API → dar um nome → copiar a chave (aparece uma única vez) → revogar quando quiser.
4. **Endpoint** — método `GET`, URL estável, cabeçalho `Authorization: Bearer SUA_CHAVE`.
5. **Parâmetros opcionais** — tabela com `tzOffset` (minutos, -840..840, use 180 para o Brasil) e `userId` (uuid).
6. **Resposta** — exemplo de JSON completo e uma tabela campo por campo (`totals`, `users[]`, `dms_sent`, `button_clicks`, `ctr`, `delivery_rate`, `replies_today`, `users_count`, `generated_at`).
7. **Como os números são calculados** — soma de automações + flows; "hoje" contado da meia-noite do fuso pedido.
8. **Códigos de erro** — 200, 400 (userId inválido), 401 (sem chave/errada/revogada), 405 (método diferente de GET), 429 (limite de 60 chamadas por minuto por chave), 500.
9. **O que o CRM precisa ter** — checklist do lado de quem recebe:
   - Guardar a chave como segredo (variável de ambiente, nunca no código do front).
   - Fazer a chamada do servidor, não do navegador (a chave não pode ir para o cliente).
   - Enviar o cabeçalho de autenticação e ler JSON UTF-8.
   - Agendador (cron) com intervalo recomendado — respeitar o limite por minuto.
   - Tratar `null` em `ctr` e `delivery_rate` (significa "ainda sem dados").
   - Tratar 401/429 com retry e alerta; não cachear a resposta.
   - Casar os registros por `user_id` (uuid estável), usando o e-mail apenas para exibição.
10. **Exemplos de integração** — `curl`, JavaScript (`fetch`) e Python (`requests`), prontos para colar.
11. **Boas práticas de segurança** — uma chave por sistema consumidor, rotação periódica, revogação imediata em caso de suspeita.

## Detalhes técnicos

- Geração com Python + ReportLab (Platypus), fonte Unicode registrada para acentos do português.
- Nenhum arquivo do app é alterado; o PDF sai em `/mnt/documents/` como artefato para download.
- Conteúdo extraído da implementação real (`src/routes/api.public.metrics.ts` e `src/components/api-keys-panel.tsx`), então os campos e códigos de erro batem com o que a API responde hoje.
- QA obrigatório: cada página convertida em imagem e inspecionada (texto cortado, sobreposição, tabelas desalinhadas) antes da entrega.

## Dúvida a confirmar

Qual URL deve constar como oficial no documento: a publicada (`https://bright-dawn-dev.lovable.app/api/public/metrics`) ou a URL estável por id do projeto (não muda se o app for renomeado)? Se não responder, uso as duas, indicando a estável como recomendada.
