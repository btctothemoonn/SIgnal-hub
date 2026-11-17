import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { createAdminSessionToken } from './admin-auth.ts';
import { TradeAuth } from './trade-auth.ts';
import { handleTrade, offlineStatus } from './trade-proxy.ts';

const salt = '1234567890abcdef';
const env = { ADMIN_PASSWORD: 'login', ADMIN_SESSION_SECRET: 'a'.repeat(32), TRADER_SESSION_SECRET: 'b'.repeat(32),
  TRADER_PIN_HASH: `scrypt$${salt}$${scryptSync('123456', salt, 32).toString('hex')}`, TRADER_INTERNAL_TOKEN: 'c'.repeat(32),
  TRADER_PUBLIC_ORIGIN: 'https://hub.example' };
const auth = new TradeAuth(env);
const admin = createAdminSessionToken(env);
let cookies = `signal_hub_admin=${admin}`;
let csrf = '';
const req = (action, data, origin = 'https://hub.example') => new Request(`https://hub.example/api/trade/${action}`, {
  method: action === 'status' ? 'GET' : 'POST', headers: { cookie: cookies, origin, 'x-csrf-token': csrf, 'content-type': 'application/json' },
  body: action === 'status' ? undefined : JSON.stringify(data ?? {})
});
const calls = [];
const fetcher = async (url, options) => {
  calls.push({ url, options });
  return Response.json(url.endsWith('/status') ? { ...offlineStatus(), fills: [{ id: '1', venue: 'binance', symbol: 'BTC', side: 'buy', price: 100, size: 1, createdAt: 1, fee: null }] }
    : { status: 'filled', warning: 'PROTECTION FAILURE', protectionError: 'PROTECTION FAILURE' });
};
const run = (request, action, extra = {}) => handleTrade(request, action, { auth, env, fetch: fetcher, ...extra });
assert.equal((await run(new Request('https://hub.example/api/trade/status'), 'status')).status, 401);
assert.equal(calls.length, 0);
let response = await run(req('status'), 'status');
assert.equal(response.status, 200);
const status = await response.json();
assert.deepEqual(Object.keys(status).sort(), ['enabled','mode','unlocked','csrfToken','accounts','limits','logs','error','fills'].sort());
assert.equal(status.fills[0].side, 'buy');
assert.equal(status.unlocked, false);
assert.equal(response.headers.get('cache-control'), 'private, no-store');
csrf = status.csrfToken;
cookies += `; signal_hub_trade_csrf=${csrf}`;
assert.equal((await run(req('order', {}), 'order')).status, 403);
response = await run(req('unlock', { pin: '123456' }), 'unlock');
assert.equal(response.status, 200);
const tradeCookie = response.headers.get('set-cookie').split(';')[0];
cookies += '; ' + tradeCookie;
assert.equal((await run(req('order', {}, 'https://evil.example'), 'order')).status, 403);
const payload = { clientOrderId: 'frontend-request-1', venue: 'binance', symbol: 'BTC', side: 'buy', type: 'market', notional: 100, leverage: 3 };
response = await run(req('order', payload), 'order');
assert.equal(response.status, 200);
assert.equal((await response.json()).protectionError, 'PROTECTION FAILURE');
assert.deepEqual(JSON.parse(calls.at(-1).options.body), payload);
assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer ' + env.TRADER_INTERNAL_TOKEN);
response = await run(req('close-all', { venue: 'hyperliquid' }), 'close-all');
assert.deepEqual(JSON.parse(calls.at(-1).options.body), { venue: 'hyperliquid' });
response = await run(req('order', payload), 'order', { fetch: async () => { throw Error('SECRET key in url'); } });
assert.equal(response.status, 503);
assert.ok(!(await response.text()).includes('SECRET'));
response = await run(req('order', payload), 'order', { fetch: async () => Response.json({ error: 'SECRET' }, { status: 500 }) });
assert.equal(response.status, 502);
assert.ok(!(await response.text()).includes('SECRET'));
response = await run(req('order', payload), 'order', { fetch: async () => Response.json({ error: 'Daily loss limit reached', safe: true }, { status: 409 }) });
assert.deepEqual(await response.json(), { error: 'Daily loss limit reached' });
response = await run(req('status'), 'status', { fetch: async () => { throw Error('SECRET'); } });
assert.equal((await response.json()).enabled, false);
response = await run(req('order', payload), 'order', { env: { ...env, TRADER_URL: 'https://evil.example' } });
assert.equal(response.status, 503);
response = await run(req('order', { value: 'x'.repeat(20000) }), 'order');
assert.equal(response.status, 413);
response = await run(req('lock'), 'lock');
assert.equal(response.status, 200);
assert.equal((await run(req('order', payload), 'order')).status, 403);
for (const action of ['status', 'unlock', 'lock', 'order', 'cancel', 'close-all']) {
  const route = await import(`../app/api/trade/${action}/route.ts`);
  assert.equal(typeof route[action === 'status' ? 'GET' : 'POST'], 'function');
}
console.log('ok - trade proxy contracts, routes, warning passthrough, access control, body bounds, sanitized failures');
