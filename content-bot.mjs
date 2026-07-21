import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'data');
const STATE_FILE = join(DATA_DIR, 'content-bot.json');
const DEFAULT_TIMES = ['12:30', '19:30', '22:30'];
const DEFAULT_SOURCES = [];

function list(value, fallback) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean).length
    ? String(value).split(',').map(item => item.trim()).filter(Boolean)
    : fallback;
}

export function contentConfig(env = process.env) {
  return {
    enabled: env.CONTENT_BOT_ENABLED === 'true',
    chatId: env.CONTENT_TELEGRAM_CHAT_ID || env.TELEGRAM_FREE_CHAT_ID,
    sources: list(env.CONTENT_REDDIT_SOURCES, DEFAULT_SOURCES),
    useGoogleTrends: env.CONTENT_GOOGLE_TRENDS !== 'false',
    times: list(env.CONTENT_POST_TIMES, DEFAULT_TIMES),
    timezone: env.CONTENT_TIMEZONE || 'America/Sao_Paulo',
    minScore: Number(env.CONTENT_MIN_SCORE || 10),
    allowNsfw: env.CONTENT_ALLOW_NSFW === 'true'
  };
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
  return [
    '🔥 ASSUNTO EM ALTA',
    '',
    cleanTitle,
    '',
    `💬 ${item.comments} comentários • ⬆️ ${item.score} votos`,
    `Fonte: ${item.source}`,
    '',
    `Leia e participe: ${item.url}`,
    '',
    '🔞 Conteúdo destinado a maiores de 18 anos.'
  ].join('\n');
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

export async function publishTrending({ config = contentConfig(), telegram, fetcher = fetch } = {}) {
  if (!config.chatId) throw new Error('CONTENT_TELEGRAM_CHAT_ID ou TELEGRAM_FREE_CHAT_ID não configurado');
  const state = await loadState();
  const requests = config.sources.map(source => fetchRedditTrending(source, { fetcher }));
  if (config.useGoogleTrends) requests.push(fetchGoogleTrends({ fetcher }));
  const results = await Promise.allSettled(requests);
  const items = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const [selected] = rankCandidates(items, { seen: state.seen, minScore: config.minScore, allowNsfw: config.allowNsfw });
  if (!selected) return { published: false, reason: 'Nenhum conteúdo novo elegível' };
  await telegram('sendMessage', {
    chat_id: config.chatId,
    text: composePost(selected),
    disable_web_page_preview: false
  });
  state.seen.push(selected.id);
  await saveState(state);
  return { published: true, item: selected };
}

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(date).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function startContentScheduler({ telegram, env = process.env, onError = console.error } = {}) {
  const config = contentConfig(env);
  if (!config.enabled) return { enabled: false, stop() {} };
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    const now = localParts(new Date(), config.timezone);
    if (!config.times.includes(now.time)) return;
    const state = await loadState();
    const slot = `${now.date}:${now.time}`;
    if (state.slots?.[slot]) return;
    running = true;
    try {
      await publishTrending({ config, telegram });
      const updated = await loadState();
      updated.slots = { ...updated.slots, [slot]: true };
      await saveState(updated);
    } catch (error) { onError(error); }
    finally { running = false; }
  }, 30_000);
  timer.unref?.();
  return { enabled: true, stop: () => clearInterval(timer) };
}
