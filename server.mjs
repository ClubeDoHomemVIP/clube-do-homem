import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { publishTrending, startContentScheduler, startTelegramController } from './content-bot.mjs';

const ROOT = process.cwd();
const DATA_FILE = join(ROOT, 'data', 'store.json');
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);

const seed = () => ({
  members: [
    { id: 'm1', name: 'Rafael Costa', email: 'rafael@email.com', telegram: '@rafaelc', telegramId: null, status: 'active', plan: 'Mensal', amount: 19.9, expiresAt: plusDays(23), joinedAt: plusDays(-67), affiliate: 'Direto' },
    { id: 'm2', name: 'Bruno Alves', email: 'bruno@email.com', telegram: '@brunoalves', telegramId: null, status: 'expiring', plan: 'Mensal', amount: 19.9, expiresAt: plusDays(2), joinedAt: plusDays(-28), affiliate: 'João Silva' },
    { id: 'm3', name: 'Lucas Mendes', email: 'lucas@email.com', telegram: '@lucasm', telegramId: null, status: 'overdue', plan: 'Mensal', amount: 19.9, expiresAt: plusDays(-3), joinedAt: plusDays(-33), affiliate: 'Direto' },
    { id: 'm4', name: 'André Lima', email: 'andre@email.com', telegram: '@andrelima', telegramId: null, status: 'active', plan: 'Vitalício', amount: 49.9, expiresAt: null, joinedAt: plusDays(-78), affiliate: 'Marcos Reis' }
  ],
  payments: [
    { id: 'pay_seed_1', memberId: 'm1', customer: 'Rafael Costa', amount: 49.9, status: 'paid', createdAt: plusDays(-7), paidAt: plusDays(-7), provider: 'Pushin Pay' },
    { id: 'pay_seed_2', memberId: 'm4', customer: 'André Lima', amount: 399, status: 'paid', createdAt: plusDays(-18), paidAt: plusDays(-18), provider: 'Pushin Pay' },
    { id: 'pay_seed_3', memberId: 'm3', customer: 'Lucas Mendes', amount: 49.9, status: 'pending', createdAt: plusDays(-1), paidAt: null, provider: 'Pushin Pay' }
  ],
  affiliates: [
    { id: 'a1', name: 'João Silva', code: 'JOAO20', sales: 18, revenue: 898.2, commission: 179.64, status: 'active' },
    { id: 'a2', name: 'Marcos Reis', code: 'MARCOS', sales: 9, revenue: 749, commission: 149.8, status: 'active' },
    { id: 'a3', name: 'Caio Souza', code: 'CAIO10', sales: 4, revenue: 199.6, commission: 39.92, status: 'paused' }
  ],
  events: [
    event('payment.paid', 'Pagamento de R$ 49,90 confirmado', 'success'),
    event('telegram.access_granted', 'Acesso liberado para Rafael Costa', 'success'),
    event('reminder.sent', 'Lembrete de renovação enviado para Bruno Alves', 'info'),
    event('subscription.overdue', 'Assinatura de Lucas Mendes venceu', 'warning')
  ],
  processedWebhooks: [],
  settings: { planName: 'Clube do Homem', monthlyPrice: 19.9, lifetimePrice: 49.9, graceDays: 2, reminderDays: [7, 3, 1], telegramConnected: false, pushinConnected: false, n8nConnected: false }
});

function plusDays(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString(); }
function event(type, message, level = 'info') { return { id: randomUUID(), type, message, level, createdAt: new Date().toISOString() }; }
async function load() {
  await mkdir(join(ROOT, 'data'), { recursive: true });
  if (!existsSync(DATA_FILE)) { const s = seed(); await save(s); return s; }
  const data = JSON.parse(await readFile(DATA_FILE, 'utf8'));
  data.settings.monthlyPrice = 19.9;
  data.settings.lifetimePrice = 49.9;
  return data;
}
async function save(data) { await writeFile(DATA_FILE, JSON.stringify(data, null, 2)); }
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
async function body(req) { const chunks = []; for await (const c of req) chunks.push(c); if (!chunks.length) return {}; return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
function safeEqual(a = '', b = '') { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function authorized(req) { const configured = process.env.ADMIN_TOKEN; return !configured || safeEqual(req.headers.authorization || '', `Bearer ${configured}`); }

async function telegram(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: true, demo: true, result: payload };
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || 'Erro no Telegram');
  return result;
}

async function grantAccess(store, member) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const expires = Math.floor(Date.now() / 1000) + 86400;
  const invite = await telegram('createChatInviteLink', { chat_id: chatId || '-1000000000000', name: `assinante-${member.id}`.slice(0, 32), expire_date: expires, member_limit: 1 });
  member.inviteLink = invite.result?.invite_link || 'https://t.me/+convite-demonstracao';
  member.status = 'active';
  member.expiresAt = member.plan === 'Vitalício' ? null : plusDays(30);
  store.events.unshift(event('telegram.access_granted', `Acesso liberado para ${member.name}`, 'success'));
  return member.inviteLink;
}

async function processPayment(store, payment) {
  const previous = store.payments.find(p => p.id === payment.id);
  if (previous?.status === 'paid') return { duplicate: true, payment: previous };
  const member = store.members.find(m => m.id === payment.memberId);
  if (!member) throw new Error('Assinante não encontrado');
  const record = previous || { id: payment.id, memberId: member.id, customer: member.name, amount: Number(payment.amount), createdAt: new Date().toISOString(), provider: payment.provider || 'Pushin Pay' };
  record.status = 'paid'; record.paidAt = new Date().toISOString();
  if (!previous) store.payments.unshift(record);
  const inviteLink = await grantAccess(store, member);
  store.events.unshift(event('payment.paid', `Pagamento de ${money(record.amount)} confirmado`, 'success'));
  return { duplicate: false, payment: record, member, inviteLink };
}
function money(v) { return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function dashboard(store) {
  const paid = store.payments.filter(p => p.status === 'paid');
  const now = Date.now(); const month = new Date().getMonth();
  return {
    metrics: {
      activeMembers: store.members.filter(m => m.status === 'active' || m.status === 'expiring').length,
      mrr: store.members.filter(m => (m.status === 'active' || m.status === 'expiring') && m.plan === 'Mensal').reduce((s, m) => s + m.amount, 0),
      revenueMonth: paid.filter(p => new Date(p.paidAt).getMonth() === month).reduce((s, p) => s + p.amount, 0),
      overdue: store.members.filter(m => m.status === 'overdue').length,
      conversion: 68.4
    },
    members: store.members, payments: store.payments, affiliates: store.affiliates, events: store.events.slice(0, 20), settings: {
      ...store.settings,
      telegramConnected: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      pushinConnected: Boolean(process.env.PUSHINPAY_API_TOKEN),
      n8nConnected: Boolean(process.env.N8N_WEBHOOK_URL)
    },
    chart: Array.from({ length: 7 }, (_, i) => ({ label: ['Jan','Fev','Mar','Abr','Mai','Jun','Jul'][i], revenue: [4200,5100,4850,6200,7100,8350,9780][i] }))
  };
}

async function api(req, res, url) {
  const store = await load();
  if (req.method === 'GET' && url.pathname === '/api/dashboard') return json(res, 200, dashboard(store));
  if (req.method === 'POST' && url.pathname === '/api/demo/payment') {
    const input = await body(req); const member = store.members.find(m => m.id === input.memberId) || store.members.find(m => m.status === 'overdue');
    const result = await processPayment(store, { id: `demo_${randomUUID()}`, memberId: member.id, amount: member.amount, provider: 'Simulação' }); await save(store); return json(res, 200, result);
  }
  if (req.method === 'POST' && url.pathname === '/api/members') {
    const input = await body(req); const member = { id: randomUUID(), name: input.name, email: input.email, telegram: input.telegram || 'Não vinculado', telegramId: input.telegramId || null, status: 'pending', plan: input.plan || 'Mensal', amount: input.plan === 'Vitalício' ? store.settings.lifetimePrice : store.settings.monthlyPrice, expiresAt: null, joinedAt: new Date().toISOString(), affiliate: input.affiliate || 'Direto' };
    store.members.unshift(member); store.events.unshift(event('lead.created', `Novo lead: ${member.name}`)); await save(store); return json(res, 201, member);
  }
  if (req.method === 'POST' && url.pathname === '/api/jobs/renewals') {
    const now = Date.now(); let removed = 0, reminded = 0;
    for (const member of store.members) {
      if (!member.expiresAt) continue; const days = Math.ceil((new Date(member.expiresAt) - now) / 86400000);
      if (store.settings.reminderDays.includes(days)) { reminded++; store.events.unshift(event('reminder.sent', `Lembrete enviado para ${member.name}`)); if (member.telegramId) await telegram('sendMessage', { chat_id: member.telegramId, text: `Olá, ${member.name.split(' ')[0]}! Sua assinatura vence em ${days} dia(s). Renove para manter seu acesso.` }); }
      if (days < -store.settings.graceDays && member.status !== 'removed') { if (member.telegramId) { await telegram('banChatMember', { chat_id: process.env.TELEGRAM_CHAT_ID, user_id: member.telegramId }); await telegram('unbanChatMember', { chat_id: process.env.TELEGRAM_CHAT_ID, user_id: member.telegramId, only_if_banned: true }); } member.status = 'removed'; removed++; store.events.unshift(event('telegram.access_removed', `${member.name} removido por inadimplência`, 'warning')); }
    }
    await save(store); return json(res, 200, { reminded, removed });
  }
  if (req.method === 'POST' && url.pathname === '/api/jobs/content') {
    if (!authorized(req)) return json(res, 401, { error: 'Não autorizado' });
    const result = await publishTrending({ telegram });
    store.events.unshift(event('content.published', result.published ? `Conteúdo publicado: ${result.item.title}` : result.reason, result.published ? 'success' : 'info'));
    await save(store); return json(res, 200, result);
  }
  if (req.method === 'POST' && url.pathname === '/api/webhooks/pushinpay') {
    const secret = process.env.PUSHINPAY_WEBHOOK_SECRET;
    if (secret && !safeEqual(req.headers['x-webhook-secret'] || '', secret)) return json(res, 401, { error: 'Assinatura inválida' });
    const payload = await body(req); const id = String(payload.id || payload.transaction_id || '');
    if (!id) return json(res, 400, { error: 'Identificador ausente' });
    if (store.processedWebhooks.includes(id)) return json(res, 200, { received: true, duplicate: true });
    const status = String(payload.status || '').toLowerCase();
    if (['paid', 'approved', 'completed'].includes(status)) await processPayment(store, { id, memberId: payload.member_id || payload.external_reference, amount: Number(payload.amount || 0) / (Number(payload.amount || 0) > 1000 ? 100 : 1) });
    store.processedWebhooks.push(id); await save(store); return json(res, 200, { received: true });
  }
  if (!authorized(req)) return json(res, 401, { error: 'Não autorizado' });
  return json(res, 404, { error: 'Rota não encontrada' });
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const requested = url.pathname === '/' ? 'index.html' : url.pathname === '/oferta' ? 'oferta.html' : url.pathname.slice(1);
    const file = normalize(join(PUBLIC, requested));
    if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'Proibido' });
    const content = await readFile(file); res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }); res.end(content);
  } catch (err) { if (err.code === 'ENOENT') return json(res, 404, { error: 'Não encontrado' }); console.error(err); json(res, 500, { error: err.message }); }
});
server.listen(PORT, () => console.log(`Clube OS rodando em http://localhost:${PORT}`));
startContentScheduler({ telegram, onError: error => console.error('[content-bot]', error.message) });
startTelegramController({ telegram, onError: error => console.error('[content-control]', error.message) });
