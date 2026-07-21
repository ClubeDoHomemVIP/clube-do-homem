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

## Rotas principais

- `GET /api/dashboard`
- `POST /api/members`
- `POST /api/demo/payment`
- `POST /api/webhooks/pushinpay`
- `POST /api/jobs/renewals`

Para volume real, substitua o arquivo JSON por Supabase/PostgreSQL e proteja as rotas administrativas com autenticação de sessão. O processamento de webhooks já é idempotente.
