import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseClient } from '../supabase-client.mjs';

test('fica desativado sem credenciais', async () => {
  const client = createSupabaseClient({});
  assert.equal(client.enabled, false);
  assert.equal(await client.health(), false);
});

test('envia chave somente nos cabeçalhos do backend', async () => {
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, text: async () => '[]' }; };
  const client = createSupabaseClient({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'secret' }, fetcher);
  assert.equal(await client.health(), true);
  assert.equal(calls[0].options.headers.apikey, 'secret');
  assert.doesNotMatch(calls[0].url, /secret/);
});
