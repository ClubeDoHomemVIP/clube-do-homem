# Operação — Clube do Homem

## Links

- Bot: https://t.me/clube_do_homem_acesso_bot
- Painel: https://clubedohomemvip.github.io/clube-do-homem/admin.html
- API: https://clube-do-homem-api.gustavofideliza.workers.dev

## Venda

1. O cliente envia `/start` ao bot.
2. Escolhe mensal (R$ 19,90) ou vitalício (R$ 49,90).
3. A Woovi gera QR Code e PIX copia e cola sem formulário.
4. O webhook assinado confirma valor e status diretamente na Woovi.
5. O bot envia convite VIP individual, válido por 24 horas e uma entrada.

## Assinatura mensal

- Validade: 30 dias.
- Lembretes automáticos: 7, 3, 1 e 0 dias antes do vencimento.
- Carência: 2 dias.
- Após a carência, o bot remove o membro do VIP e envia orientação para renovar.
- Uma renovação antecipada acrescenta 30 dias ao prazo existente.
- A rotina executa diariamente às 09h (horário de Brasília).

## Afiliados

No painel, informe nome, código e percentual. O sistema cria um link no formato:

`https://t.me/clube_do_homem_acesso_bot?start=ref_CODIGO`

Cliques, vendas, receita e comissão aparecem no painel.

## Segurança

- Credenciais ficam em Secrets do Cloudflare.
- Painel exige `ADMIN_API_KEY`.
- Webhook Woovi valida assinatura RSA-SHA256 e confirma a cobrança novamente pela API.
- Pagamentos e webhooks são processados com proteção contra duplicidade.

## Teste final pendente

Fazer uma compra PIX real e confirmar: cobrança, webhook, convite VIP e registro no painel.
