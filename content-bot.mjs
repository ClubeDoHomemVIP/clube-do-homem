import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

const DATA_DIR = join(process.cwd(), 'data');
const STATE_FILE = join(DATA_DIR, 'content-bot.json');
const DEFAULT_TIMES = ['12:30', '19:30', '22:30'];
const DEFAULT_SOURCES = [];
const DEFAULT_NEWS_QUERIES = ['OnlyFans Brasil', 'Privacy criadores', 'criadores de conteúdo adulto', 'mercado de conteúdo adulto'];
const BLOCKED_TERMS = /\b(leak|leaks|leaked|vazad[oa]s?|sem consentimento|pirataria|pack vazado)\b/i;

function list(value, fallback) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean).length
    ? String(value).split(',').map(item => item.trim()).filter(Boolean)
    : fallback;
}

function queryList(value) {
  return String(value || '').split('|').map(item => item.trim()).filter(Boolean).length
    ? String(value).split('|').map(item => item.trim()).filter(Boolean)
    : DEFAULT_NEWS_QUERIES;
}

export function contentConfig(env = process.env) {
  return {
    enabled: env.CONTENT_BOT_ENABLED === 'true',
    chatId: env.CONTENT_TELEGRAM_CHAT_ID || env.TELEGRAM_FREE_CHAT_ID,
    controlKey: env.CONTENT_CONTROL_KEY || env.ADMIN_TOKEN,
    adminChatId: env.CONTENT_ADMIN_CHAT_ID,
    sources: list(env.CONTENT_REDDIT_SOURCES, DEFAULT_SOURCES),
    newsQueries: queryList(env.CONTENT_NEWS_QUERIES),
    useGoogleTrends: env.CONTENT_GOOGLE_TRENDS === 'true',
    times: list(env.CONTENT_POST_TIMES, DEFAULT_TIMES),
    timezone: env.CONTENT_TIMEZONE || 'America/Sao_Paulo',
    minScore: Number(env.CONTENT_MIN_SCORE || 10),
    allowNsfw: env.CONTENT_ALLOW_NSFW === 'true'
  };
}

export async function fetchGoogleNews(query, { fetcher = fetch } = {}) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Google Notícias: HTTP ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match, index) => {
    const block = match[1];
    const title = xmlTag(block, 'title');
    return {
      id: `news:${title.toLowerCase()}`,
      source: xmlTag(block, 'source') || 'Google Notícias',
      title,
      url: xmlTag(block, 'link'),
      score: Math.max(20, 1000 - index * 10),
      comments: 0,
      nsfw: false,
      createdAt: new Date(xmlTag(block, 'pubDate') || Date.now()).toISOString()
    };
  }).filter(item => item.title && item.url && !BLOCKED_TERMS.test(item.title));
}

function decodeXml(value = '') {
  return value.replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

function xmlTag(xml, tag) {
  const escaped = tag.replace(':', '\\:');
  return decodeXml(xml.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'))?.[1] || '');
}

function trafficScore(value) {
  const number = Number(String(value).replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
  if (/M/i.test(value)) return number * 1_000_000;
  if (/K/i.test(value)) return number * 1_000;
  return number;
}

export async function fetchGoogleTrends({ fetcher = fetch, geo = 'BR' } = {}) {
  const response = await fetcher(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`);
  if (!response.ok) throw new Error(`Google Trends: HTTP ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match => {
    const block = match[1];
    const title = xmlTag(block, 'title');
    const url = xmlTag(block, 'link');
    return {
      id: `trends:${title.toLowerCase()}`,
      source: 'Google Trends Brasil',
      title,
      url,
      score: trafficScore(xmlTag(block, 'ht:approx_traffic')),
      comments: 0,
      nsfw: false,
      createdAt: new Date(xmlTag(block, 'pubDate') || Date.now()).toISOString()
    };
  }).filter(item => item.title && item.url);
}

export async function fetchRedditTrending(source, { limit = 25, fetcher = fetch } = {}) {
  const url = `https://www.reddit.com/r/${encodeURIComponent(source)}/hot.json?limit=${limit}&raw_json=1`;
  const response = await fetcher(url, { headers: { 'user-agent': 'ClubeDoHomemContentBot/1.0' } });
  if (!response.ok) throw new Error(`Reddit ${source}: HTTP ${response.status}`);
  const payload = await response.json();
  return (payload.data?.children || []).map(({ data }) => ({
    id: `reddit:${data.id}`,
    source: `r/${source}`,
    title: String(data.title || '').trim(),
    url: `https://www.reddit.com${data.permalink}`,
    score: Number(data.score || 0),
    comments: Number(data.num_comments || 0),
    nsfw: Boolean(data.over_18),
    createdAt: new Date(Number(data.created_utc || 0) * 1000).toISOString()
  })).filter(item => item.title && item.url);
}

export function rankCandidates(items, { seen = [], minScore = 10, allowNsfw = false } = {}) {
  const used = new Set(seen);
  return items
    .filter(item => !used.has(item.id) && item.score >= minScore && (allowNsfw || !item.nsfw))
    .sort((a, b) => (b.score + b.comments * 2) - (a.score + a.comments * 2));
}

export function composePost(item) {
  const cleanTitle = item.title.replace(/\s+/g, ' ').slice(0, 220);
  const engagement = item.comments
    ? `💬 ${item.comments} comentários • ⬆️ ${item.score} votos`
    : '📈 Tendência selecionada do mercado adulto';
  return [
    '🔥 HOT NEWS • 18+',
    '',
    cleanTitle,
    '',
    engagement,
    `Fonte: ${item.source}`,
    '',
    `Leia e participe: ${item.url}`,
    '',
    '🔞 Conteúdo destinado a maiores de 18 anos.'
  ].join('\n');
}

function secretMatches(received = '', expected = '') {
  const a = Buffer.from(String(received));
  const b = Buffer.from(String(expected));
  return Boolean(expected) && a.length === b.length && timingSafeEqual(a, b);
}

async function loadState() {
  await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(STATE_FILE)) return { seen: [], slots: {} };
  return JSON.parse(await readFile(STATE_FILE, 'utf8'));
}

async function saveState(state) {
  state.seen = state.seen.slice(-500);
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function sendSelected({ item, chatId, telegram }) {
  await telegram('sendMessage', { chat_id: chatId, text: composePost(item), disable_web_page_preview: false });
}

export async function publishTrending({ config = contentConfig(), telegram, fetcher = fetch, approvalRequired = false, adminChatId } = {}) {
  if (!config.chatId) throw new Error('CONTENT_TELEGRAM_CHAT_ID ou TELEGRAM_FREE_CHAT_ID não configurado');
  const state = await loadState();
  const requests = config.sources.map(source => fetchRedditTrending(source, { fetcher }));
  requests.push(...config.newsQueries.map(query => fetchGoogleNews(query, { fetcher })));
  if (config.useGoogleTrends) requests.push(fetchGoogleTrends({ fetcher }));
  const results = await Promise.allSettled(requests);
  const items = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const [selected] = rankCandidates(items, { seen: state.seen, minScore: config.minScore, allowNsfw: config.allowNsfw });
  if (!selected) return { published: false, reason: 'Nenhum conteúdo novo elegível' };
  if (approvalRequired) {
    const destination = adminChatId || state.control?.adminChatId || config.adminChatId;
    if (!destination) throw new Error('Registre o administrador com /registrar SUA_CHAVE');
    state.pending = selected;
    await telegram('sendMessage', {
      chat_id: destination,
      text: `PRÉVIA — ainda não publicado\n\n${composePost(selected)}\n\n/aprovar SUA_CHAVE\n/recusar SUA_CHAVE`,
      disable_web_page_preview: false
    });
    await saveState(state);
    return { published: false, pendingApproval: true, item: selected };
  }
  await sendSelected({ item: selected, chatId: config.chatId, telegram });
  state.seen.push(selected.id);
  await saveState(state);
  return { published: true, item: selected };
}

export async function handleControlCommand({ text, chatId, telegram, env = process.env } = {}) {
  const config = contentConfig(env);
  const [command = '', key = ''] = String(text || '').trim().split(/\s+/, 2);
  const action = command.toLowerCase().split('@')[0];
  if (action === '/start' || action === '/ajuda') {
    const siteUrl = env.PUBLIC_SITE_URL || 'https://clubedohomemvip.github.io/clube-do-homem/';
    const freeUrl = env.TELEGRAM_FREE_URL || 'https://t.me/previasclubedohomem';
    const reply = action === '/start'
      ? `Bem-vindo ao Clube do Homem 🔞\n\nEscolha uma opção:\n• Conhecer os planos: ${siteUrl}\n• Entrar no grupo de prévias grátis: ${freeUrl}\n\nApós a confirmação do pagamento, seu convite individual para o VIP será enviado por aqui.`
      : `Precisa de ajuda?\n\nPlanos e acesso: ${siteUrl}\nPrévias gratuitas: ${freeUrl}\n\nSe o pagamento já foi realizado, aguarde a confirmação automática antes de tentar novamente.`;
    await telegram('sendMessage', { chat_id: chatId, text: reply, disable_web_page_preview: true });
    return { handled: true, authorized: true, action };
  }
  if (!['/registrar', '/ativar', '/desativar', '/aprovacao', '/automatico', '/aprovar', '/recusar', '/status'].includes(action)) return { handled: false };
  if (!secretMatches(key, config.controlKey)) {
    await telegram('sendMessage', { chat_id: chatId, text: 'Chave inválida.' });
    return { handled: true, authorized: false };
  }
  const state = await loadState();
  state.control ||= { enabled: config.enabled, approvalRequired: true, adminChatId: config.adminChatId || null };
  if (state.control.adminChatId && String(state.control.adminChatId) !== String(chatId) && action !== '/registrar') {
    await telegram('sendMessage', { chat_id: chatId, text: 'Este chat não é o administrador registrado.' });
    return { handled: true, authorized: false };
  }
  let response = '';
  if (action === '/registrar') { state.control.adminChatId = chatId; response = 'Administrador registrado. Modo de aprovação ativado.'; state.control.approvalRequired = true; }
  if (action === '/ativar') { state.control.enabled = true; response = 'Postagens ativadas.'; }
  if (action === '/desativar') { state.control.enabled = false; response = 'Postagens desativadas.'; }
  if (action === '/aprovacao') { state.control.approvalRequired = true; response = 'Modo de aprovação ativado.'; }
  if (action === '/automatico') { state.control.approvalRequired = false; response = 'Modo automático ativado.'; }
  if (action === '/recusar') { state.pending = null; response = 'Prévia descartada.'; }
  if (action === '/aprovar') {
    if (!state.pending) response = 'Não há publicação aguardando aprovação.';
    else {
      await sendSelected({ item: state.pending, chatId: config.chatId, telegram });
      state.seen.push(state.pending.id); state.pending = null; response = 'Publicação aprovada e enviada.';
    }
  }
  if (action === '/status') response = `Bot: ${state.control.enabled ? 'ATIVO' : 'DESATIVADO'}\nModo: ${state.control.approvalRequired ? 'APROVAÇÃO' : 'AUTOMÁTICO'}\nPrévia pendente: ${state.pending ? 'SIM' : 'NÃO'}`;
  await saveState(state);
  await telegram('sendMessage', { chat_id: chatId, text: response });
  return { handled: true, authorized: true, action };
}

export function startTelegramController({ telegram, env = process.env, onError = console.error } = {}) {
  const config = contentConfig(env);
  if (!env.TELEGRAM_BOT_TOKEN) return { enabled: false, stop() {} };
  let stopped = false; let offset = 0;
  const loop = async () => {
    while (!stopped) {
      try {
        const updates = await telegram('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
        for (const update of updates.result || []) {
          offset = update.update_id + 1;
          if (update.message?.text) await handleControlCommand({ text: update.message.text, chatId: update.message.chat.id, telegram, env });
        }
      } catch (error) { onError(error); await new Promise(resolve => setTimeout(resolve, 3000)); }
    }
  };
  loop();
  return { enabled: true, stop: () => { stopped = true; } };
}

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(date).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function startContentScheduler({ telegram, env = process.env, onError = console.error } = {}) {
  const config = contentConfig(env);
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    const now = localParts(new Date(), config.timezone);
    if (!config.times.includes(now.time)) return;
    const state = await loadState();
    const enabled = state.control?.enabled ?? config.enabled;
    if (!enabled) return;
    const slot = `${now.date}:${now.time}`;
    if (state.slots?.[slot]) return;
    running = true;
    try {
      await publishTrending({ config, telegram, approvalRequired: state.control?.approvalRequired ?? true, adminChatId: state.control?.adminChatId });
      const updated = await loadState();
      updated.slots = { ...updated.slots, [slot]: true };
      await saveState(updated);
    } catch (error) { onError(error); }
    finally { running = false; }
  }, 30_000);
  timer.unref?.();
  return { enabled: config.enabled, stop: () => clearInterval(timer) };
}
