import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { createAdminSessionToken } from './admin-auth.ts';
import { TradeAuth, PIN_COOKIE, CSRF_COOKIE } from './trade-auth.ts';

const salt = '1234567890abcdef';
const env = { ADMIN_PASSWORD: 'login', ADMIN_SESSION_SECRET: 'a'.repeat(32),
  TRADER_SESSION_SECRET: 'b'.repeat(32), TRADER_PIN_HASH: `scrypt$${salt}$${scryptSync('123456', salt, 32).toString('hex')}`,
  TRADER_PUBLIC_ORIGIN: 'https://hub.example', NODE_ENV: 'production' };
let now = 1800000000000;
const auth = new TradeAuth(env, () => now);
const admin = createAdminSessionToken(env, now);
const request = (cookies = '', origin = 'https://hub.example', csrf = '') => new Request('https://hub.example/api/trade/order', {
  method: 'POST', headers: { cookie: `signal_hub_admin=${admin}; ${cookies}`, origin, 'x-csrf-token': csrf }
});
assert.throws(() => auth.session(new Request('https://hub.example/api/trade/status')), /login/i);
const session = auth.session(request());
const csrf = auth.csrf(session);
const cookies = `${CSRF_COOKIE}=${csrf}`;
assert.throws(() => auth.write(request(cookies, 'https://evil.example', csrf)), /origin/i);
assert.throws(() => auth.write(request(cookies, 'null', csrf)), /origin/i);
assert.throws(() => auth.write(request(cookies, 'https://hub.example', 'bad')), /CSRF/);
assert.throws(() => auth.write(request(cookies, 'https://hub.example', csrf)), /unlock/i);
const unlockRequest = request(cookies, 'https://hub.example', csrf);
const token = await auth.unlock(unlockRequest, '123456');
assert.ok(auth.write(request(`${cookies}; ${PIN_COOKIE}=${token}`, undefined, csrf)));
assert.ok(auth.cookie(PIN_COOKIE, token).includes('HttpOnly'));
assert.ok(auth.cookie(PIN_COOKIE, token).includes('Secure'));
assert.ok(auth.cookie(PIN_COOKIE, token).includes('SameSite=Strict'));
assert.equal(auth.unlocked(session, token + 'x'), false);
assert.equal(auth.unlocked('other-session', token), false);
now += 8 * 3600000;
assert.equal(auth.unlocked(session, token), false);
for (let i = 0; i < 5; i++) await assert.rejects(auth.unlock(unlockRequest, 'bad'), /PIN/);
await assert.rejects(auth.unlock(unlockRequest, '123456'), /attempts/);
now += 16 * 60000;
const next = await auth.unlock(unlockRequest, '123456');
auth.lock(next);
assert.equal(auth.unlocked(session, next), false);
console.log('ok - trade login, CSRF, signed unlock, expiry, revocation, PIN throttling');
