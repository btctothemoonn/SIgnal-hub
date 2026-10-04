import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';
import { createWebPushClient, getPushEnvironment } from './web-push-client.ts';
import * as pushClientModule from './web-push-client.ts';
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

const privateErrorText = 'https://web.push.apple.com/private-endpoint?token=private-token key=private-key';
function enrollmentHarness(failure = {}) {
 const calls = [], saved = new Map(); let subscription = null, enrolled = false, writes = 0;
 const registration = { pushManager: {
  getSubscription: async () => subscription,
  subscribe: async options => {
   calls.push('browser_subscription');
   if (failure.browserError) throw failure.browserError;
   subscription = { options, toJSON: () => ({ endpoint: 'https://web.push.apple.com/diagnostic-fixture', expirationTime: null, keys: { p256dh: key, auth: Buffer.alloc(16).toString('base64url') } }), unsubscribe: async () => { subscription = null; return true; } };
   return subscription;
  },
 } };
 const browser = { secureContext: true, userAgent: 'iPhone Chrome', standalone: true, available: true,
  notification: { permission: 'default', requestPermission: () => {
   calls.push('permission');
   if (failure.permissionSyncError) throw failure.permissionSyncError;
   if (failure.permissionAsyncError) return Promise.reject(failure.permissionAsyncError);
   browser.notification.permission = 'granted'; return Promise.resolve('granted');
  } },
  register: async () => registration, crypto: webcrypto,
  storage: { getItem: name => saved.get(name) ?? null, setItem: (name, value) => {
   writes++;
   if (failure.storageError && writes === (failure.failWrite ?? 1)) throw failure.storageError;
   saved.set(name, value);
  } },
 };
 const api = async (path, options = {}) => {
  if (path.endsWith('/config')) return { enabled: true, configured: true, publicKey: key };
  if (options.method === 'POST') {
   calls.push('server_registration');
   if (failure.serverError) throw failure.serverError;
   enrolled = true; return { epoch: 1 };
  }
  if (failure.confirmationError) throw failure.confirmationError;
  return { enabled: enrolled && !failure.unconfirmed, epoch: 1 };
 };
 return { client: createWebPushClient(api, browser), calls, browser };
}

for (const [name, failure, stage, code, expectedCalls] of [
 ['synchronous permission failure', { permissionSyncError: new DOMException(privateErrorText, 'NotAllowedError') }, 'permission', 'NotAllowedError', ['permission']],
 ['asynchronous permission failure', { permissionAsyncError: new DOMException(privateErrorText, 'AbortError') }, 'permission', 'AbortError', ['permission']],
 ['device proof storage failure', { storageError: new DOMException(privateErrorText, 'QuotaExceededError') }, 'device_storage', 'QuotaExceededError', ['permission']],
 ['browser subscription failure', { browserError: new DOMException(privateErrorText, 'AbortError') }, 'browser_subscription', 'AbortError', ['permission', 'browser_subscription']],
 ['same-origin server rejection', { serverError: new Error('same_origin_required') }, 'server_registration', 'same_origin_required', ['permission', 'browser_subscription', 'server_registration']],
 ['invalid device server rejection', { serverError: new Error('invalid_device') }, 'server_registration', 'invalid_device', ['permission', 'browser_subscription', 'server_registration']],
 ['proof persistence after enrollment failure', { storageError: new DOMException(privateErrorText, 'QuotaExceededError'), failWrite: 2 }, 'device_storage', 'QuotaExceededError', ['permission', 'browser_subscription', 'server_registration']],
 ['confirmation API rejection', { confirmationError: new Error('login_required') }, 'confirmation', 'login_required', ['permission', 'browser_subscription', 'server_registration']],
 ['confirmation without enabled subscription', { unconfirmed: true }, 'confirmation', 'enrollment_unconfirmed', ['permission', 'browser_subscription', 'server_registration']],
 ['unknown browser error without private detail', { browserError: new Error(privateErrorText) }, 'browser_subscription', 'push_request_failed', ['permission', 'browser_subscription']],
]) {
 test(`enrollment diagnoses ${name} without changing attempts`, async () => {
  const { client, calls } = enrollmentHarness(failure);
  assert.equal((await client.readStatus()).state, 'ready');
  let pending;
  assert.doesNotThrow(() => { pending = client.enableFromUserGesture(); }, 'permission failures must reject with diagnostics instead of escaping synchronously');
  await assert.rejects(pending, error => {
   assert.equal(error.stage, stage, 'failure must retain its enrollment boundary');
   assert.equal(error.code, code, 'failure must retain only a safe diagnostic code');
   assert.equal(error.message, code, 'raw error details must not survive in the public error');
   assert.equal(error.cause, undefined, 'private browser or API error must not be retained');
   assert.equal(typeof pushClientModule.getPushErrorMessage, 'function');
   const message = pushClientModule.getPushErrorMessage(error);
   assert.ok(message.includes(code)); assert.ok(message.includes(stage));
   assert.doesNotMatch(message, /private-endpoint|private-token|private-key|https:/);
   return true;
  });
  assert.deepEqual(calls, expectedCalls, 'diagnostics must not retry or advance past a failed boundary');
 });
}

test('diagnostics keep permission request synchronous and preserve successful enrollment', async () => {
 const { client, calls } = enrollmentHarness();
 assert.equal((await client.readStatus()).state, 'ready');
 const pending = client.enableFromUserGesture();
 assert.deepEqual(calls, ['permission'], 'permission prompt must start during the click call');
 assert.deepEqual(await pending, { state: 'enabled', enabled: true });
 assert.deepEqual(calls, ['permission', 'browser_subscription', 'server_registration']);
});

test('plain known API errors explain same-origin rejection and the address check', () => {
 assert.equal(typeof pushClientModule.getPushErrorMessage, 'function');
 const message = pushClientModule.getPushErrorMessage(new Error('same_origin_required'));
 assert.ok(message.includes('same_origin_required')); assert.ok(message.includes('网址')); assert.ok(message.includes('阶段'));
});

test('plain known API errors offer a safe next step', () => {
 assert.equal(typeof pushClientModule.getPushErrorMessage, 'function');
 assert.match(pushClientModule.getPushErrorMessage(new Error('login_required')), /重新登录/);
 assert.match(pushClientModule.getPushErrorMessage(new Error('control_rate_limited')), /稍后/);
});

test('enrollment confirmation preserves missing proof while ordinary status remains tolerant', async () => {
 const { client } = enrollmentHarness({ confirmationError: new Error('device_proof_required') });
 assert.equal((await client.readStatus()).state, 'ready');
 await assert.rejects(client.enableFromUserGesture(), error => {
  assert.equal(error.code, 'device_proof_required');
  assert.equal(error.stage, 'confirmation');
  return true;
 });
 assert.deepEqual(await client.readStatus(), { state: 'ready', enabled: false });
});

test('unknown errors and DOMException details are never included in diagnostics', () => {
 assert.equal(typeof pushClientModule.getPushErrorMessage, 'function');
 for (const error of [new Error(privateErrorText), new DOMException(privateErrorText, 'NotAllowedError'), new DOMException(privateErrorText, 'PrivateSecretName'), { message: privateErrorText, name: 'PrivateSecretName' }, null]) {
  const message = pushClientModule.getPushErrorMessage(error);
  assert.doesNotMatch(message, /private-endpoint|private-token|private-key|https:|PrivateSecretName/);
  assert.ok(message.includes('阶段'));
 }
});

test('DOMException diagnostics use only known browser names and ignore their message', () => {
 const aborted = pushClientModule.getPushErrorMessage(new DOMException('same_origin_required', 'AbortError'));
 assert.ok(aborted.includes('AbortError')); assert.ok(!aborted.includes('same_origin_required'));
 const inventedName = pushClientModule.getPushErrorMessage(new DOMException(privateErrorText, 'same_origin_required'));
 assert.ok(inventedName.includes('push_request_failed'), 'an API error code is not a known DOMException name');
 assert.ok(!inventedName.includes('same_origin_required'));
});
