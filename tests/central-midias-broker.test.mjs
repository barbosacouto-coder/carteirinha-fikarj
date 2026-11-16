import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/central-midias-worker/handler.mjs';

const env = { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only-test',
  CENTRAL_MIDIAS_BROKER_TOKEN: 'test-only-broker-token-at-least-32-characters' };
const request = (body, token = env.CENTRAL_MIDIAS_BROKER_TOKEN) => new Request('https://fixture.test', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-fikarj-worker-key': token }, body: JSON.stringify(body),
});
test('unauthorized token cannot call database', async () => {
  const handler = createHandler(env, () => { throw new Error('must not call'); });
  assert.equal((await handler(request({ operation: 'claim' }, 'wrong'))).status, 401);
});
test('claim calls only fixed RPC with one item and never leaks server key', async () => {
  const calls = [];
  const handler = createHandler(env, async (url, init) => {
    calls.push({ url, init }); return new Response('[]', { status: 200 });
  });
  const result = await handler(request({ operation: 'claim' }));
  assert.deepEqual(await result.json(), []);
  assert.equal(calls[0].url, `${env.SUPABASE_URL}/rest/v1/rpc/central_midias_worker_claim`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_limite: 1 });
  assert.equal(calls[0].init.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
});
test('arbitrary RPC and claim arguments are refused', async () => {
  let calls = 0;
  const handler = createHandler(env, async () => { calls++; return new Response('[]'); });
  for (const body of [{ operation: 'sql', sql: 'select 1' }, { operation: 'claim', p_limite: 10 }, []]) {
    assert.equal((await handler(request(body))).status, 400);
  }
  assert.equal(calls, 0);
});
test('finalize validates lease shape then forwards only allowed fields', async () => {
  let forwarded;
  const handler = createHandler(env, async (url, init) => {
    forwarded = { url, body: JSON.parse(init.body) }; return new Response(null, { status: 204 });
  });
  const body = { operation: 'finalize', destination_id: '11111111-1111-4111-8111-111111111111',
    lease_token: '22222222-2222-4222-8222-222222222222', result: 'publicado', external_id: 'meta-test-id' };
  assert.equal((await handler(request({ ...body, lease_token: 'invalid' }))).status, 400);
  assert.equal(forwarded, undefined);
  assert.equal((await handler(request(body))).status, 200);
  assert.equal(forwarded.body.p_lease_token, body.lease_token);
  assert.equal(forwarded.body.p_id_externo, body.external_id);
});
test('database errors and configuration never expose credentials', async () => {
  const handler = createHandler(env, async () => new Response(env.SUPABASE_SERVICE_ROLE_KEY, { status: 500 }));
  const result = await handler(request({ operation: 'claim' }));
  assert.equal(result.status, 502);
  assert.equal((await result.text()).includes(env.SUPABASE_SERVICE_ROLE_KEY), false);
  assert.equal((await createHandler({})(request({ operation: 'claim' }))).status, 503);
});
test('oversize authenticated payload is rejected before database', async () => {
  let calls = 0;
  const handler = createHandler(env, async () => { calls++; return new Response('[]'); });
  assert.equal((await handler(request({ operation: 'claim', extra: 'x'.repeat(5000) }))).status, 413);
  assert.equal(calls, 0);
});
