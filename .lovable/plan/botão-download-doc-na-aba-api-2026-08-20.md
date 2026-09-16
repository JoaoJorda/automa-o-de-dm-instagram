# Botão "Download Doc" na aba API

Colocar um botão na aba **API** das Configurações que baixa o PDF da documentação da API que já foi gerado.

## O que muda na tela

No primeiro card ("Endereço da API"), ao lado do endereço/copiar, entra um botão **Download Doc** (com ícone de download). Ao clicar, o navegador baixa o arquivo `InstaDesbloqMe-API-Metricas.pdf` direto — sem abrir aba nova nem pedir login.

## Como o arquivo fica disponível

O PDF passa a morar junto do site, na pasta de arquivos públicos do projeto (`public/docs/`). É como colocar o PDF numa gaveta que o site inteiro pode abrir: ele vira um endereço fixo (`/docs/InstaDesbloqMe-API-Metricas.pdf`) que funciona tanto no preview quanto no site publicado.

## Detalhes técnicos

- Copiar o PDF de `/mnt/documents/InstaDesbloqMe-API-Metricas.pdf` para `public/docs/InstaDesbloqMe-API-Metricas.pdf` (criar a pasta `public/` — hoje o projeto não tem uma; o Vite serve essa pasta na raiz por padrão).
- Em `src/components/api-keys-panel.tsx`: adicionar um `<Button asChild variant="outline" size="sm">` envolvendo um `<a href="/docs/InstaDesbloqMe-API-Metricas.pdf" download>` com ícone `Download` do lucide, no `CardContent` do card "Endereço da API".
- Nenhuma mudança de backend, rota ou banco.
