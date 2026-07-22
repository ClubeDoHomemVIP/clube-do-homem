import qrcode from 'qrcode-generator';

const ALLOWED_ORIGINS = new Set([
  'https://clubedohomemvip.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]);

const json = (data, status = 200, origin = '') => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(ALLOWED_ORIGINS.has(origin) ? {
      'access-control-allow-origin': origin,
      vary: 'Origin'
    } : {})
  }
});

async function supabase(env, path, options = {}) {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...(options.prefer ? { prefer: options.prefer } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function syncPayToken(env) {
  const response = await fetch('https://api.syncpayments.com.br/api/partner/v1/auth-token', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: env.SYNCPAY_CLIENT_ID, client_secret: env.SYNCPAY_CLIENT_SECRET })
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error('Falha ao autenticar na SyncPay');
  return result.access_token;
}

async function syncPay(env, path, options = {}) {
  const token = await syncPayToken(env);
  const response = await fetch(`https://api.syncpayments.com.br/api/partner/v1/${path}`, {
    method: options.method || 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || `SyncPay HTTP ${response.status}`);
  return result;
}

async function telegram(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || 'Erro no Telegram');
  return result.result;
}

const PLANS = {
  monthly: { label: 'Mensal', amountCents: 1990 },
  lifetime: { label: 'Vitalício', amountCents: 4990 }
};

async function telegramPhoto(env, chatId, pixCode, caption, replyMarkup) {
  const qr = qrcode(0, 'M');
  qr.addData(pixCode);
  qr.make();
  const dataUrl = qr.createDataURL(7, 12);
  const [meta, encoded] = dataUrl.split(',');
  const mime = meta.match(/data:([^;]+)/)?.[1] || 'image/gif';
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('photo', new Blob([bytes], { type: mime }), 'pix.gif');
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');
  form.append('reply_markup', JSON.stringify(replyMarkup));
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || 'Erro ao enviar QR no Telegram');
  return result.result;
}

async function sendWelcomeBanner(env, chatId) {
  return telegram(env, 'sendPhoto', {
    chat_id: chatId,
    photo: 'https://raw.githubusercontent.com/ClubeDoHomemVIP/clube-do-homem/master/public/assets/bot-banner-feminino.png',
    parse_mode: 'HTML',
    caption: '🔥 <b>CLUBE DO HOMEM VIP</b>\n\nConteúdo exclusivo, novidades frequentes e acesso privado. 🔞\n\nToque abaixo para conhecer as opções de acesso.',
    reply_markup: { inline_keyboard: [[
      { text: '⭐ CONHECER OS PLANOS', callback_data: 'show_plans' }
    ]] }
  });
}

async function sendPlans(env, chatId) {
  return telegram(env, 'sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: '💎 <b>ESCOLHA SEU ACESSO VIP</b>\n\n📅 <b>Mensal — R$ 19,90</b>\nAcesso por 30 dias.\n\n♾ <b>Vitalício — R$ 49,90</b>\nPagamento único e acesso permanente.\n\n👇 Selecione um plano para gerar seu PIX:',
    reply_markup: { inline_keyboard: [
      [{ text: '📅 MENSAL — R$ 19,90', callback_data: 'plan_monthly' }],
      [{ text: '♾ VITALÍCIO — R$ 49,90', callback_data: 'plan_lifetime' }]
    ] }
  });
}

async function woovi(env, path, options = {}) {
  const response = await fetch(`https://api.openpix.com.br/api/openpix/v1/${path}`, {
    method: options.method || 'GET',
    headers: { Authorization: env.WOOVI_APP_ID, 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || result.message || `Woovi HTTP ${response.status}`);
  return result;
}

async function telegramCustomer(env, user, chatId) {
  const found = await supabase(env, `customers?telegram_user_id=eq.${user.id}&select=id&limit=1`);
  if (found?.[0]) return found[0];
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || `Telegram ${user.id}`;
  const created = await supabase(env, 'customers', {
    method: 'POST', prefer: 'return=representation', body: {
      name, telegram_user_id: user.id, telegram_username: user.username || null,
      status: 'pending'
    }
  });
  await supabase(env, 'events', { method: 'POST', body: {
    event_type: 'telegram_started', entity_type: 'customer', entity_id: created[0].id,
    payload: { chat_id: chatId }
  } });
  return created[0];
}

async function sendPlanPix(env, chatId, user, requestedPlan = 'monthly') {
  const plan = requestedPlan === 'lifetime' ? 'lifetime' : 'monthly';
  const selected = PLANS[plan];
  const customer = await telegramCustomer(env, user, chatId);
  const subscriptions = await supabase(env, 'subscriptions', {
    method: 'POST', prefer: 'return=representation', body: {
      customer_id: customer.id, plan, amount_cents: selected.amountCents, status: 'pending'
    }
  });
  const correlationID = `tg-${user.id}-${plan}-${crypto.randomUUID()}`;
  const result = await woovi(env, 'charge', { method: 'POST', body: {
    correlationID, value: selected.amountCents,
    comment: `Clube do Homem VIP - Plano ${selected.label}`
  } });
  const charge = result.charge || result;
  const pixCode = charge.brCode || charge.br_code || charge.pixCode;
  if (!pixCode) throw new Error('Woovi não retornou o código PIX');
  await supabase(env, 'payments', { method: 'POST', body: {
    provider_id: correlationID, customer_id: customer.id, subscription_id: subscriptions[0].id,
    provider: 'woovi', amount_cents: selected.amountCents, status: 'pending',
    raw_payload: { telegram_chat_id: chatId, woovi_charge: charge }
  } });
  const price = (selected.amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const caption = `🔞 <b>Clube do Homem VIP</b>\n\n💎 Plano ${selected.label}: <b>${price}</b>\n📱 Escaneie o QR Code ou toque no código abaixo para copiar.\n\n<code>${escapeHtml(pixCode)}</code>\n\n✅ Acesso enviado automaticamente após a confirmação.\n🔒 Conteúdo adulto legal e exclusivo para maiores de 18 anos.`;
  await telegramPhoto(env, chatId, pixCode, caption, { inline_keyboard: [
    [{ text: '📋 Copiar PIX', copy_text: { text: pixCode } }],
    [{ text: plan === 'monthly' ? '⭐ Escolher vitalício — R$ 49,90' : '📅 Escolher mensal — R$ 19,90', callback_data: plan === 'monthly' ? 'plan_lifetime' : 'plan_monthly' }],
    [{ text: '🔄 Gerar novo PIX', callback_data: `plan_${plan}` }]
  ] });
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function telegramWebhook(request, env, origin) {
  const update = await request.json();
  if (update.callback_query) {
    const callback = update.callback_query;
    if (callback.data === 'show_plans') {
      await telegram(env, 'answerCallbackQuery', { callback_query_id: callback.id });
      await sendPlans(env, callback.message.chat.id);
    } else {
      await telegram(env, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'Gerando seu PIX…' });
      const plan = callback.data === 'plan_lifetime' ? 'lifetime' : 'monthly';
      await sendPlanPix(env, callback.message.chat.id, callback.from, plan);
    }
  } else if (update.message?.text?.startsWith('/start')) {
    await sendWelcomeBanner(env, update.message.chat.id);
  }
  return json({ received: true }, 200, origin);
}

async function wooviWebhook(request, env, origin) {
  const payload = await request.json();
  const event = String(payload.event || payload.type || '');
  if (event && !/(charge|transaction).*(complete|paid)|complete|paid/i.test(event)) return json({ received: true, ignored: true }, 200, origin);
  const charge = payload.charge || payload.data?.charge || payload.data || {};
  const correlationID = String(charge.correlationID || charge.correlationId || payload.correlationID || '');
  // A Woovi envia uma requisição de validação sem cobrança ao cadastrar o webhook.
  if (!correlationID) return json({ received: true, test: true }, 200, origin);
  const payments = await supabase(env, `payments?provider=eq.woovi&provider_id=eq.${encodeURIComponent(correlationID)}&select=id,amount_cents,customer_id,subscription_id,status,raw_payload&limit=1`);
  const payment = payments?.[0];
  if (!payment) return json({ error: 'Pagamento não encontrado' }, 404, origin);
  if (payment.status === 'paid') return json({ received: true, duplicate: true }, 200, origin);
  const verifiedResult = await woovi(env, `charge/${encodeURIComponent(correlationID)}`);
  const verified = verifiedResult.charge || verifiedResult;
  const status = String(verified.status || '').toUpperCase();
  if (!['COMPLETED', 'PAID'].includes(status) || Number(verified.value) !== payment.amount_cents) {
    return json({ error: 'Pagamento não confirmado na Woovi' }, 409, origin);
  }
  const invite = await telegram(env, 'createChatInviteLink', {
    chat_id: env.TELEGRAM_CHAT_ID, name: `woovi-${correlationID}`.slice(0, 32),
    expire_date: Math.floor(Date.now() / 1000) + 86400, member_limit: 1
  });
  const now = new Date().toISOString();
  await supabase(env, `payments?id=eq.${payment.id}`, { method: 'PATCH', body: {
    status: 'paid', paid_at: now,
    raw_payload: { ...payment.raw_payload, webhook: payload, invite_link: invite.invite_link }
  } });
  const subscription = await supabase(env, `subscriptions?id=eq.${payment.subscription_id}&select=plan&limit=1`);
  await supabase(env, `subscriptions?id=eq.${payment.subscription_id}`, { method: 'PATCH', body: {
    status: 'active', starts_at: now,
    expires_at: subscription?.[0]?.plan === 'lifetime' ? null : new Date(Date.now() + 30 * 86400000).toISOString()
  } });
  await supabase(env, `customers?id=eq.${payment.customer_id}`, { method: 'PATCH', body: { status: 'active' } });
  await telegram(env, 'sendMessage', {
    chat_id: payment.raw_payload.telegram_chat_id, parse_mode: 'HTML',
    text: `✅ <b>Pagamento confirmado!</b>\n\nSeu acesso VIP está liberado:\n${invite.invite_link}\n\n⏳ Link individual, válido por 24 horas e para uma única entrada.`
  });
  return json({ received: true }, 200, origin);
}

async function customerForCheckout(env, input) {
  const cpf = String(input.cpf).replace(/\D/g, '');
  const email = String(input.email || `cliente+${cpf}@clubedohomem.local`).trim().toLowerCase();
  const found = await supabase(env, `customers?email=eq.${encodeURIComponent(email)}&select=id&limit=1`);
  if (found?.[0]) return found[0];
  const created = await supabase(env, 'customers', {
    method: 'POST', prefer: 'return=representation', body: {
      name: String(input.name).trim(), email,
      telegram_username: input.telegram || null, status: 'pending'
    }
  });
  return created[0];
}

async function createCheckout(request, env, origin) {
  const input = await request.json();
  const cpf = String(input.cpf || '').replace(/\D/g, '');
  const phone = String(input.phone || '').replace(/\D/g, '');
  if (!input.name || cpf.length !== 11 || ![10, 11].includes(phone.length)) {
    return json({ error: 'Preencha nome, CPF e telefone válidos' }, 400, origin);
  }
  const plan = input.plan === 'lifetime' ? 'lifetime' : 'monthly';
  const amount = plan === 'lifetime' ? 49.9 : 19.9;
  const customer = await customerForCheckout(env, input);
  const subscriptions = await supabase(env, 'subscriptions', {
    method: 'POST', prefer: 'return=representation', body: {
      customer_id: customer.id, plan, amount_cents: Math.round(amount * 100), status: 'pending'
    }
  });
  const webhookUrl = `${new URL(request.url).origin}/api/webhooks/syncpay`;
  const charge = await syncPay(env, 'cash-in', {
    method: 'POST', body: {
      amount, description: `Clube do Homem - ${plan === 'lifetime' ? 'Vitalício' : 'Mensal'}`,
      webhook_url: webhookUrl,
      client: { name: String(input.name).trim(), cpf, email: `cliente+${cpf}@clubedohomem.local`, phone }
    }
  });
  await supabase(env, 'payments', {
    method: 'POST', body: {
      provider_id: charge.identifier, customer_id: customer.id, subscription_id: subscriptions[0].id,
      provider: 'syncpay', amount_cents: Math.round(amount * 100), status: 'pending',
      raw_payload: { checkout_created: true }
    }
  });
  const qr = qrcode(0, 'M');
  qr.addData(charge.pix_code);
  qr.make();
  return json({ identifier: charge.identifier, pixCode: charge.pix_code, qrCodeSvg: qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true }), amount, plan }, 201, origin);
}

async function paymentStatus(env, identifier, origin) {
  const rows = await supabase(env, `payments?provider_id=eq.${encodeURIComponent(identifier)}&select=status,raw_payload&limit=1`);
  if (!rows?.[0]) return json({ error: 'Pagamento não encontrado' }, 404, origin);
  return json({ status: rows[0].status, inviteLink: rows[0].raw_payload?.invite_link || null }, 200, origin);
}

async function syncPayWebhook(request, env, origin) {
  const payload = await request.json();
  const data = payload.data || payload;
  const identifier = String(data.id || data.identifier || data.idtransaction || '');
  if (!identifier && /test webhook/i.test(String(payload.message || ''))) return json({ received: true, test: true }, 200, origin);
  if (!identifier) return json({ error: 'Identificador ausente' }, 400, origin);
  const existing = await supabase(env, `webhook_events?provider=eq.syncpay&provider_event_id=eq.${encodeURIComponent(identifier)}&select=id,processed_at&limit=1`);
  if (existing?.[0]?.processed_at) return json({ received: true, duplicate: true }, 200, origin);
  if (!existing?.[0]) await supabase(env, 'webhook_events', { method: 'POST', body: { provider: 'syncpay', provider_event_id: identifier, payload } });
  const status = String(data.status || '').toLowerCase();
  if (['paid', 'approved', 'completed'].includes(status)) {
    const payments = await supabase(env, `payments?provider_id=eq.${encodeURIComponent(identifier)}&select=id,amount_cents,customer_id,subscription_id&limit=1`);
    const payment = payments?.[0];
    if (!payment) return json({ error: 'Pagamento não encontrado' }, 404, origin);
    const checked = await syncPay(env, `transaction/${encodeURIComponent(identifier)}`);
    const transaction = checked.data || checked;
    if (String(transaction.status).toLowerCase() !== 'completed' || Math.abs(Number(transaction.amount) * 100 - payment.amount_cents) >= 1) {
      return json({ error: 'Pagamento não confirmado na SyncPay' }, 409, origin);
    }
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    const invite = await telegram(env, 'createChatInviteLink', {
      chat_id: env.TELEGRAM_CHAT_ID, name: `pagamento-${identifier}`.slice(0, 32),
      expire_date: Math.floor(Date.now() / 1000) + 86400, member_limit: 1
    });
    await supabase(env, `payments?id=eq.${payment.id}`, { method: 'PATCH', body: { status: 'paid', paid_at: new Date().toISOString(), raw_payload: { webhook: payload, invite_link: invite.invite_link } } });
    const subscription = await supabase(env, `subscriptions?id=eq.${payment.subscription_id}&select=plan&limit=1`);
    await supabase(env, `subscriptions?id=eq.${payment.subscription_id}`, { method: 'PATCH', body: { status: 'active', starts_at: new Date().toISOString(), expires_at: subscription?.[0]?.plan === 'lifetime' ? null : new Date(Date.now() + 30 * 86400000).toISOString() } });
    await supabase(env, `customers?id=eq.${payment.customer_id}`, { method: 'PATCH', body: { status: 'active' } });
    void expiresAt;
  }
  await supabase(env, `webhook_events?provider=eq.syncpay&provider_event_id=eq.${encodeURIComponent(identifier)}`, { method: 'PATCH', body: { processed_at: new Date().toISOString() } });
  return json({ received: true }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
      ...(ALLOWED_ORIGINS.has(origin) ? { 'access-control-allow-origin': origin } : {}),
      'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type'
    } });
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/api/health') {
        await supabase(env, 'customers?select=id&limit=1');
        return json({ ok: true, database: true }, 200, origin);
      }
      if (request.method === 'POST' && url.pathname === '/api/checkout/pix') return await createCheckout(request, env, origin);
      if (request.method === 'GET' && url.pathname.startsWith('/api/checkout/status/')) return await paymentStatus(env, decodeURIComponent(url.pathname.split('/').pop()), origin);
      if (request.method === 'POST' && url.pathname === '/api/webhooks/syncpay') return await syncPayWebhook(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/api/webhooks/telegram') return await telegramWebhook(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/api/webhooks/woovi') return await wooviWebhook(request, env, origin);
      return json({ error: 'Rota não encontrada' }, 404, origin);
    } catch (error) {
      console.error(error);
      return json({ error: 'Erro interno' }, 500, origin);
    }
  }
};
