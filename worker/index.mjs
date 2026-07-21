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

async function customerForCheckout(env, input) {
  const email = String(input.email).trim().toLowerCase();
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
  if (!input.name || !input.email || cpf.length !== 11 || ![10, 11].includes(phone.length)) {
    return json({ error: 'Preencha nome, e-mail, CPF e telefone válidos' }, 400, origin);
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
      client: { name: String(input.name).trim(), cpf, email: String(input.email).trim().toLowerCase(), phone }
    }
  });
  await supabase(env, 'payments', {
    method: 'POST', body: {
      provider_id: charge.identifier, customer_id: customer.id, subscription_id: subscriptions[0].id,
      provider: 'syncpay', amount_cents: Math.round(amount * 100), status: 'pending',
      raw_payload: { checkout_created: true }
    }
  });
  return json({ identifier: charge.identifier, pixCode: charge.pix_code, amount, plan }, 201, origin);
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
      return json({ error: 'Rota não encontrada' }, 404, origin);
    } catch (error) {
      console.error(error);
      return json({ error: 'Erro interno' }, 500, origin);
    }
  }
};
