import test from 'node:test';
import assert from 'node:assert/strict';
import { composePost, contentConfig, fetchGoogleTrends, fetchRedditTrending, rankCandidates } from '../content-bot.mjs';

test('configura horários e grupo gratuito', () => {
  const config = contentConfig({ TELEGRAM_FREE_CHAT_ID: '-1001', CONTENT_POST_TIMES: '19:30,22:30' });
  assert.equal(config.chatId, '-1001');
  assert.deepEqual(config.times, ['19:30', '22:30']);
});

test('normaliza resposta pública do Reddit', async () => {
  const fetcher = async () => ({ ok: true, json: async () => ({ data: { children: [{ data: { id: 'abc', title: 'Tema em alta', permalink: '/r/x/comments/abc', score: 99, num_comments: 12, over_18: false, created_utc: 1 } }] } }) });
  const [item] = await fetchRedditTrending('x', { fetcher });
  assert.equal(item.id, 'reddit:abc');
  assert.match(item.url, /reddit\.com/);
});

test('lê assuntos em alta do Google Trends', async () => {
  const xml = '<rss><channel><item><title><![CDATA[Tema popular]]></title><link>https://trends.google.com/x</link><pubDate>Mon, 20 Jul 2026 10:00:00 GMT</pubDate><ht:approx_traffic>20K+</ht:approx_traffic></item></channel></rss>';
  const fetcher = async () => ({ ok: true, text: async () => xml });
  const [item] = await fetchGoogleTrends({ fetcher });
  assert.equal(item.title, 'Tema popular');
  assert.equal(item.score, 20000);
});

test('filtra repetidos e NSFW e prioriza engajamento', () => {
  const items = [
    { id: 'a', score: 50, comments: 2, nsfw: false },
    { id: 'b', score: 20, comments: 50, nsfw: false },
    { id: 'c', score: 500, comments: 50, nsfw: true }
  ];
  assert.equal(rankCandidates(items, { seen: ['a'], minScore: 10 })[0].id, 'b');
});

test('gera postagem com crédito e link', () => {
  const text = composePost({ title: 'Uma conversa interessante', comments: 30, score: 80, source: 'r/teste', url: 'https://reddit.com/x' });
  assert.match(text, /Fonte: r\/teste/);
  assert.match(text, /https:\/\/reddit\.com\/x/);
});
