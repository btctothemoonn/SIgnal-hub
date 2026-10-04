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
function enrollmentHarness(failure = {}, suppliedStorage) {
 const calls = [], saved = new Map(), enrollments = [], revocations = []; let subscription = null, enrolled = false, writes = 0;
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
  storage: suppliedStorage ?? { getItem: name => saved.get(name) ?? null, setItem: (name, value) => {
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
   const body = JSON.parse(options.body);
   const persisted = JSON.parse(browser.storage.getItem(pushClientModule.PUSH_DEVICE_STORAGE_KEY) ?? 'null');
   assert.equal(body.deviceId, persisted?.deviceId, 'server registration requires an already durable device ID');
   assert.equal(body.deviceKey, persisted?.deviceKey, 'server registration requires an already durable proof');
   enrollments.push(body);
   enrolled = true; return { epoch: 1 };
  }
  if (options.method === 'DELETE') {
   revocations.push(options.headers); enrolled = false; return { success: true };
  }
  if (failure.confirmationError) throw failure.confirmationError;
  return { enabled: enrolled && !failure.unconfirmed, epoch: 1 };
 };
 return { client: createWebPushClient(api, browser), calls, browser, api, enrollments, revocations };
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

function capacityStorage(entries, options = {}) {
 const values = new Map(entries), removed = [], writes = [];
 const usage = () => [...values].reduce((sum, [name, value]) => sum + name.length + value.length, 0);
 const capacity = options.capacity ?? usage();
 const storage = {
  get length() { return values.size; },
  key: index => [...values.keys()][index] ?? null,
  getItem: name => values.get(name) ?? null,
  setItem: (name, value) => {
   writes.push(name);
   if (options.writeError) throw options.writeError;
   const previous = values.get(name);
   const nextUsage = usage() - (previous === undefined ? 0 : name.length + previous.length) + name.length + value.length;
   if (nextUsage > capacity) throw new DOMException(privateErrorText, 'QuotaExceededError');
   values.set(name, value);
  },
  removeItem: name => { values.delete(name); removed.push(name); },
 };
 return { storage, values, removed, writes };
}

const protectedCacheEntries = [
 ['signal-hub:stocks:hynix-premium:selected-interval:v1', '5m'],
 ['signal-hub:theme:cromojo-dark-dashboard:v1', 'dark'],
 ['signal-hub:favorites:v1', 'NVDA'],
 ['signal-hub:reading-anchor:v1', 'saved-position'],
 ['signal-hub:stocks:hynix-premium:v3:1m', 'unsupported-legacy'.repeat(2000)],
 ['signal-hub:stocks:hynix-premium:v2:1h', 'unknown-legacy'.repeat(2000)],
 ['signal-hub:stocks:hynix-premium:1h:v2', 'unknown-legacy-layout'.repeat(2000)],
 ['signal-hub:stocks:hynix-premium:v5:5m', 'future-version'.repeat(2000)],
 ['signal-hub:stocks:hynix-premium:v4:15m', 'unsupported'.repeat(1000)],
 ['signal-hub:stocks:hynix-funding:v2', 'unknown-version'.repeat(1000)],
 ['signal-hub:stocks:market-snapshot:v1:extra', 'unknown-suffix'.repeat(1000)],
 ['signal-hub:stocks:performance-snapshot:v1:', 'empty-tickers'.repeat(1000)],
 ['signal-hub:stocks:performance-snapshot:v1:AAPL,MSFT', 'unencoded-tickers'.repeat(1000)],
 ['signal-hub:stocks:performance-snapshot:v1:%ZZ', 'invalid-encoding'.repeat(1000)],
 ['unrelated-private-data', 'unknown-user-data'.repeat(1000)],
];

test('quota recovery removes only the largest approved cache and survives client reload with the same logout proof', async () => {
 const largestKey = 'signal-hub:stocks:hynix-premium:v4:5m';
 const keptKey = 'signal-hub:stocks:performance-snapshot:v1:AAPL%2CMSFT';
 const capacity = capacityStorage([...protectedCacheEntries, [keptKey, 's'.repeat(1000)], [largestKey, 'l'.repeat(4000)], ['signal-hub:stocks:hynix-funding:v1', 'f'.repeat(2000)]]);
 const { client, calls, browser, api, enrollments, revocations } = enrollmentHarness({}, capacity.storage);
 assert.equal((await client.readStatus()).state, 'ready');
 const pending = client.enableFromUserGesture();
 assert.deepEqual(calls, ['permission'], 'quota recovery must not delay the permission prompt');
 assert.deepEqual(await pending, { state: 'enabled', enabled: true });
 assert.deepEqual(capacity.removed, [largestKey]);
 assert.equal(capacity.writes.length, 3, 'one failed first write, one retry and one enrollment metadata write');
 for (const [name, value] of protectedCacheEntries) assert.equal(capacity.values.get(name), value);
 assert.equal(capacity.values.get(keptKey), 's'.repeat(1000));
 const proof = JSON.parse(capacity.values.get(pushClientModule.PUSH_DEVICE_STORAGE_KEY));
 assert.equal(proof.deviceId, enrollments[0].deviceId);
 assert.equal(proof.deviceKey, enrollments[0].deviceKey);
 const reloaded = createWebPushClient(api, browser);
 assert.deepEqual(await reloaded.readStatus(), { state: 'enabled', enabled: true });
 assert.deepEqual(reloaded.getLogoutFields(), { pushDeviceId: proof.deviceId, pushDeviceKey: proof.deviceKey });
 await reloaded.disable();
 assert.equal(revocations[0]['X-Signal-Push-Device'], proof.deviceId);
 assert.equal(revocations[0]['X-Signal-Push-Device-Key'], proof.deviceKey);
 assert.deepEqual(capacity.removed, [largestKey], 'later status/revoke does not clean another cache');
});

test('only the exact current rebuildable cache keys qualify for quota recovery', async () => {
 for (const name of [
  'signal-hub:stocks:hynix-premium:v4:1m', 'signal-hub:stocks:hynix-premium:v4:5m',
  'signal-hub:stocks:hynix-premium:v4:1h', 'signal-hub:stocks:hynix-premium:v4:1d',
  'signal-hub:stocks:hynix-funding:v1', 'signal-hub:stocks:performance-snapshot:v1:AAPL%2CMSFT',
  'signal-hub:stocks:market-snapshot:v1', 'signal-hub:stocks:financial-snapshot:v1',
  'signal-hub.binance-holding-snapshot.v1', 'signal-hub.tiger-holding-snapshot.v1', 'signal-hub.tiger-equity-history.v1',
 ]) {
  const capacity = capacityStorage([[name, 'cache'.repeat(200)]]);
  const { client } = enrollmentHarness({}, capacity.storage);
  await client.readStatus();
  assert.equal((await client.enableFromUserGesture()).state, 'enabled', name);
  assert.deepEqual(capacity.removed, [name]);
 }
});

for (const legacyKey of [
 'signal-hub:stocks:hynix-premium:5m:v1',
 'signal-hub:stocks:hynix-premium:5m:v2',
 'signal-hub:stocks:hynix-premium:v3:5m',
 'signal-hub:stocks:hynix-premium:v3:1h',
 'signal-hub:stocks:hynix-premium:v3:1d',
]) {
 test(`verified legacy cache ${legacyKey} alone can recover quota while larger unknown legacy data survives`, async () => {
  const capacity = capacityStorage([...protectedCacheEntries, [legacyKey, 'known-cache'.repeat(200)]]);
  const { client, browser, api } = enrollmentHarness({}, capacity.storage);
  await client.readStatus();
  assert.equal((await client.enableFromUserGesture()).state, 'enabled');
  assert.deepEqual(capacity.removed, [legacyKey]);
  for (const [name, value] of protectedCacheEntries) assert.equal(capacity.values.get(name), value);
  const proof = JSON.parse(capacity.values.get(pushClientModule.PUSH_DEVICE_STORAGE_KEY));
  const reloaded = createWebPushClient(api, browser);
  assert.equal((await reloaded.readStatus()).state, 'enabled');
  assert.deepEqual(reloaded.getLogoutFields(), { pushDeviceId: proof.deviceId, pushDeviceKey: proof.deviceKey });
 });
}

test('quota with no approved cache fails before subscription or POST and does not use memory proof', async () => {
 const capacity = capacityStorage(protectedCacheEntries);
 const { client, calls, enrollments } = enrollmentHarness({}, capacity.storage);
 await client.readStatus();
 await assert.rejects(client.enableFromUserGesture(), error => error.stage === 'device_storage' && error.code === 'QuotaExceededError');
 assert.deepEqual(calls, ['permission']);
 assert.deepEqual(enrollments, []);
 assert.deepEqual(capacity.removed, []);
 assert.equal(capacity.writes.length, 1);
 assert.deepEqual(client.getLogoutFields(), {});
 assert.equal(capacity.values.has(pushClientModule.PUSH_DEVICE_STORAGE_KEY), false);
 assert.deepEqual(await client.readStatus(), { state: 'ready', enabled: false });
});

test('a failed quota retry stops after deleting one cache and never reaches POST', async () => {
 const largestKey = 'signal-hub:stocks:market-snapshot:v1';
 const capacity = capacityStorage([[largestKey, 'l'.repeat(20)], ['signal-hub:stocks:financial-snapshot:v1', 's'.repeat(10)]]);
 const { client, calls } = enrollmentHarness({}, capacity.storage);
 await client.readStatus();
 await assert.rejects(client.enableFromUserGesture(), error => error.stage === 'device_storage' && error.code === 'QuotaExceededError');
 assert.deepEqual(capacity.removed, [largestKey]);
 assert.equal(capacity.writes.length, 2, 'there is only one persistent retry');
 assert.deepEqual(calls, ['permission']);
 assert.deepEqual(client.getLogoutFields(), {});
 assert.equal(capacity.values.get('signal-hub:stocks:financial-snapshot:v1'), 's'.repeat(10));
});

test('non-quota failures and quota-like Error names never delete cached data', async () => {
 const namedError = new Error(privateErrorText); namedError.name = 'QuotaExceededError';
 for (const writeError of [new DOMException(privateErrorText, 'SecurityError'), namedError, { name: 'QuotaExceededError', message: privateErrorText }]) {
  const capacity = capacityStorage([['signal-hub:stocks:market-snapshot:v1', 'cache'.repeat(200)]], { writeError });
  const { client, calls } = enrollmentHarness({}, capacity.storage);
  await client.readStatus();
  await assert.rejects(client.enableFromUserGesture(), error => error.stage === 'device_storage');
  assert.deepEqual(capacity.removed, []);
  assert.equal(capacity.writes.length, 1);
  assert.deepEqual(calls, ['permission']);
 }
});

test('unavailable enumeration or removal preserves the quota diagnostic without POST', async () => {
 for (const fault of ['missing-methods', 'length', 'key', 'candidate-read', 'remove']) {
  const capacity = capacityStorage([['signal-hub:stocks:market-snapshot:v1', 'cache'.repeat(200)]]);
  const unavailable = () => { throw new DOMException(privateErrorText, 'SecurityError'); };
  if (fault === 'missing-methods') { delete capacity.storage.key; delete capacity.storage.removeItem; }
  if (fault === 'length') Object.defineProperty(capacity.storage, 'length', { get: unavailable });
  if (fault === 'key') capacity.storage.key = unavailable;
  if (fault === 'candidate-read') {
   const getItem = capacity.storage.getItem;
   capacity.storage.getItem = name => name === pushClientModule.PUSH_DEVICE_STORAGE_KEY ? getItem(name) : unavailable();
  }
  if (fault === 'remove') capacity.storage.removeItem = unavailable;
  const { client, calls } = enrollmentHarness({}, capacity.storage);
  await client.readStatus();
  await assert.rejects(client.enableFromUserGesture(), error => error.stage === 'device_storage' && error.code === 'QuotaExceededError', fault);
  assert.deepEqual(capacity.removed, []);
  assert.equal(capacity.writes.length, 1);
  assert.deepEqual(calls, ['permission']);
 }
});

test('quota while updating existing credentials keeps the same device ID and key for reload and logout', async () => {
 const oldProof = { deviceId: webcrypto.randomUUID(), deviceKey: Buffer.alloc(32, 9).toString('base64url') };
 const cacheKey = 'signal-hub.tiger-equity-history.v1';
 const capacity = capacityStorage([[pushClientModule.PUSH_DEVICE_STORAGE_KEY, JSON.stringify(oldProof)], [cacheKey, 'cache'.repeat(200)]]);
 const { client, browser, api, enrollments } = enrollmentHarness({}, capacity.storage);
 await client.readStatus();
 assert.equal((await client.enableFromUserGesture()).state, 'enabled');
 assert.deepEqual(capacity.removed, [cacheKey]);
 assert.equal(capacity.writes.length, 2, 'metadata update retries once without replacing the existing device proof');
 const persisted = JSON.parse(capacity.values.get(pushClientModule.PUSH_DEVICE_STORAGE_KEY));
 assert.equal(persisted.deviceId, oldProof.deviceId);
 assert.equal(persisted.deviceKey, oldProof.deviceKey);
 assert.equal(enrollments[0].deviceId, oldProof.deviceId);
 assert.equal(enrollments[0].deviceKey, oldProof.deviceKey);
 const reloaded = createWebPushClient(api, browser);
 assert.equal((await reloaded.readStatus()).state, 'enabled');
 assert.deepEqual(reloaded.getLogoutFields(), { pushDeviceId: oldProof.deviceId, pushDeviceKey: oldProof.deviceKey });
});

test('one enrollment never deletes a second cache when metadata cannot fit after the first proof recovery', async () => {
 const largestKey = 'signal-hub:stocks:market-snapshot:v1';
 const smallerKey = 'signal-hub:stocks:financial-snapshot:v1';
 const capacity = capacityStorage([[largestKey, 'l'.repeat(150)], [smallerKey, 's'.repeat(100)]]);
 const { client, enrollments } = enrollmentHarness({}, capacity.storage);
 await client.readStatus();
 await assert.rejects(client.enableFromUserGesture(), error => error.stage === 'device_storage' && error.code === 'QuotaExceededError');
 assert.deepEqual(capacity.removed, [largestKey]);
 assert.equal(capacity.writes.length, 3, 'base proof retries once; metadata cannot reclaim another cache');
 assert.equal(capacity.values.get(smallerKey), 's'.repeat(100));
 assert.equal(enrollments.length, 1, 'the durable base proof existed before server registration');
 const persisted = JSON.parse(capacity.values.get(pushClientModule.PUSH_DEVICE_STORAGE_KEY));
 assert.deepEqual(client.getLogoutFields(), { pushDeviceId: persisted.deviceId, pushDeviceKey: persisted.deviceKey });
 assert.equal(persisted.publicKey, undefined, 'failed metadata write is not represented as success');
 assert.equal(persisted.deviceId, enrollments[0].deviceId);
 assert.equal(persisted.deviceKey, enrollments[0].deviceKey);
});

test('disable keeps its original storage failure without reclaiming cached data', async () => {
 const fault = { capacity: 10_000 };
 const capacity = capacityStorage([['signal-hub:stocks:market-snapshot:v1', 'cache'.repeat(200)]], fault);
 const { client, revocations } = enrollmentHarness({}, capacity.storage);
 await client.readStatus();
 await client.enableFromUserGesture();
 fault.writeError = new DOMException(privateErrorText, 'QuotaExceededError');
 await assert.rejects(client.disable(), error => error instanceof DOMException && error.name === 'QuotaExceededError');
 assert.equal(revocations.length, 1);
 assert.deepEqual(capacity.removed, []);
});
