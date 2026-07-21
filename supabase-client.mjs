export function createSupabaseClient(env = process.env, fetcher = fetch) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const enabled = Boolean(url && key);

  async function request(path, { method = 'GET', body, prefer } = {}) {
    if (!enabled) return null;
    const response = await fetcher(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'user-agent': 'ClubeDoHomem-Backend/1.0',
        ...(prefer ? { prefer } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${text}`);
    return text ? JSON.parse(text) : null;
  }

  return {
    enabled,
    health: async () => enabled ? (await request('customers?select=id&limit=1'), true) : false,
    createCustomer: customer => request('customers', {
      method: 'POST', prefer: 'return=representation', body: {
        id: customer.id, name: customer.name, email: customer.email || null,
        telegram_username: customer.telegram || null,
        telegram_user_id: customer.telegramId || null,
        status: customer.status || 'lead'
      }
    }),
    createSubscription: subscription => request('subscriptions', {
      method: 'POST', prefer: 'return=representation', body: subscription
    }),
    recordEvent: item => request('events', {
      method: 'POST', body: { id: item.id, event_type: item.type, payload: { message: item.message, level: item.level } }
    })
  };
}
