import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createWebPushClient, getPushEnvironment } from './web-push-client.ts';
const storage = new Map(), order = []; let permissionRequests = 0, enrolled = false, revoked = false;
const key = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 2)]).toString('base64url');
let existing = null;
const registration = { pushManager: { getSubscription: async () => existing, subscribe: async options => { existing = { options, toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/a', keys: { p256dh: key, auth: Buffer.alloc(16).toString('base64url') } }), unsubscribe: async () => { order.push('browser-unsubscribe'); existing = null; return true; } }; return existing; } } };
const browser = { secureContext: true, userAgent: 'Chrome Windows', standalone: false, available: true, notification: { permission: 'default', requestPermission: () => { permissionRequests++; order.push('permission'); browser.notification.permission = 'granted'; return Promise.resolve('granted'); } }, register: async () => { order.push('register'); return registration; }, crypto: webcrypto, storage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, v); order.push('persist'); } } };
const api = async (path, init = {}) => {
 order.push(init.method ?? 'GET');
 if (path.endsWith('/config')) return { enabled: true, configured: true, publicKey: key };
 if (init.method === 'POST') { assert.ok(storage.size); enrolled = true; return { epoch: 1 }; }
 if (init.method === 'DELETE') { if (!revoked) throw new Error('revoke failed'); enrolled = false; order.push('server-revoke'); return { success: true }; }
 return { enabled: enrolled, epoch: 1 };
};
const client = createWebPushClient(api, browser);
assert.equal((await client.readStatus()).state, 'ready'); assert.equal(permissionRequests, 0);
order.length = 0;
const enabling = client.enableFromUserGesture(); assert.equal(order[0], 'permission', 'requestPermission starts before any await'); await enabling;
assert.equal((await client.readStatus()).state, 'enabled'); assert.equal(permissionRequests, 1);
const fields = client.getLogoutFields(); assert.ok(fields.pushDeviceId && fields.pushDeviceKey);
await assert.rejects(() => client.disable()); assert.equal(existing !== null, true, 'server revoke failure keeps browser subscription');
revoked = true; order.length = 0; await client.disable(); assert.ok(order.indexOf('server-revoke') < order.indexOf('browser-unsubscribe'));
assert.equal(getPushEnvironment({ ...browser, userAgent: 'iPhone Chrome', standalone: false }).needsHomeScreen, true);
assert.equal(getPushEnvironment({ ...browser, userAgent: 'iPhone Chrome', standalone: true }).supported, true);
const broken = createWebPushClient(api, { ...browser, register: async () => { throw new Error('registration failed'); } });
assert.equal((await broken.readStatus()).state, 'error');
console.log('browser push lifecycle tests passed');
