# Clube OS

MVP de gestão de conteúdo pago no Telegram: painel, assinantes, PIX via webhook, convite individual, renovação, remoção, afiliados e auditoria.

## Executar

```powershell
Copy-Item .env.example .env
node server.mjs
```

Acesse `http://localhost:3000`. Sem credenciais, Telegram e pagamentos operam em demonstração. O botão **Simular venda PIX** executa o fluxo completo.

## Produção

1. Crie um bot no `@BotFather` e adicione-o como administrador do grupo privado, com permissão para convidar e remover membros.
2. Preencha `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` no ambiente.
3. Configure no gateway o webhook `POST https://seu-dominio/api/webhooks/pushinpay`.
4. Envie o ID do assinante em `member_id` ou `external_reference`; o handler aceita os estados `paid`, `approved` e `completed`.
5. Proteja o webhook com `PUSHINPAY_WEBHOOK_SECRET` no header `x-webhook-secret` (ajuste o adaptador se a conta usar outro mecanismo de assinatura).
6. Agende `POST /api/jobs/renewals` diariamente no n8n ou no cron da hospedagem.

## Curadoria automática para o grupo gratuito

O bot consulta notícias sobre OnlyFans, Privacy, criadores 18+ e o mercado adulto; cria uma chamada curta com crédito e publica no Telegram sem copiar o conteúdo integral. Termos ligados a vazamentos e pirataria são bloqueados.

1. Configure `TELEGRAM_FREE_CHAT_ID` (ou `CONTENT_TELEGRAM_CHAT_ID`).
2. Ajuste os temas separados por `|` em `CONTENT_NEWS_QUERIES`. Google Trends e Reddit são opcionais.
3. Defina os horários em `CONTENT_POST_TIMES` no fuso `CONTENT_TIMEZONE`.
4. Ative com `CONTENT_BOT_ENABLED=true` e mantenha o servidor online.
5. Para testar manualmente, envie `POST /api/jobs/content` com `Authorization: Bearer SEU_ADMIN_TOKEN`.

Por padrão, conteúdo marcado como NSFW é ignorado. Use apenas fontes e mídias cuja republicação seja permitida; o bot publica título, métricas e link para a fonte.

### Controle privado pelo Telegram

Configure `CONTENT_CONTROL_KEY` (ou use o `ADMIN_TOKEN`) e mande ao bot no privado:

- `/registrar CHAVE`: registra seu chat como administrador.
- `/ativar CHAVE` e `/desativar CHAVE`: controla o agendador.
- `/aprovacao CHAVE`: recebe prévias antes da publicação.
- `/automatico CHAVE`: publica sem aprovação manual.
- `/aprovar CHAVE`, `/recusar CHAVE` e `/status CHAVE`: gerenciam a fila.

## Rotas principais

- `GET /api/dashboard`
- `POST /api/members`
- `POST /api/demo/payment`
- `POST /api/webhooks/pushinpay`
- `POST /api/jobs/renewals`

Para volume real, substitua o arquivo JSON por Supabase/PostgreSQL e proteja as rotas administrativas com autenticação de sessão. O processamento de webhooks já é idempotente.
