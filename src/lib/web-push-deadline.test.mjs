import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { createECDH, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import webPush from 'web-push';
import { createWebPushSender } from './web-push-sender.ts';

const ec = createECDH('prime256v1'); ec.generateKeys();
const config = { enabled: true, configured: true, publicKey: ec.getPublicKey().toString('base64url'), privateKey: ec.getPrivateKey().toString('base64url'), subject: 'mailto:ops@example.com', errorCode: null };
const sub = { endpoint: 'https://fcm.googleapis.com/example', expirationTime: null, keys: { p256dh: config.publicKey, auth: randomBytes(16).toString('base64url') } };

function useTransportFixture(t, mode = 'slow') {
  // Encryption is real. Only the clock and HTTPS boundary are controlled, so
  // machine speed cannot consume a simulated network deadline accidentally.
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_700_000_000_000 });
  const requests = [];
  t.mock.method(https, 'request', (_url, options, callback) => {
    if (typeof options === 'function') { callback = options; options = _url; }
    const request = new EventEmitter(); const response = new EventEmitter();
    response.statusCode = 201; response.headers = {};
    response.resume = () => {}; response.destroy = () => {};
    request.destroyed = false; request.write = () => {};
    const entry = { request, options, packets: 0, responseStarted: false };
    requests.push(entry);
    let drip, end;
    const clearNetworkTimers = () => { clearInterval(drip); clearTimeout(end); };
    t.after(clearNetworkTimers);
    request.destroy = error => {
      request.destroyed = true; clearNetworkTimers();
      queueMicrotask(() => request.emit('error', error)); return request;
    };
    if (mode !== 'dns') {
      drip = setInterval(() => { entry.packets++; response.emit('data', Buffer.from('x')); }, 2);
      end = setTimeout(() => { clearInterval(drip); response.emit('end'); }, mode === 'fast' ? 2 : 180);
    }
    request.end = () => {
      if (mode !== 'dns') queueMicrotask(() => { entry.responseStarted = true; callback(response); });
    };
    return request;
  });
  return { sender: createWebPushSender(config), requests };
}

function observe(promise) {
  const state = { settled: false, completedAt: null, promise: null };
  state.promise = promise.then(result => { state.settled = true; state.completedAt = Date.now(); return result; });
  return state;
}

async function flushContinuations() {
  // Flush the queued HTTPS callback/error and the transport, sender and
  // observation promise continuations without advancing the virtual clock.
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
}

async function advance(t, milliseconds) {
  t.mock.timers.tick(milliseconds);
  await flushContinuations();
}

test('continuously dripping response is destroyed at the total deadline', async t => {
  const { sender, requests } = useTransportFixture(t);
  const startedAt = Date.now();
  const pending = observe(sender.send(sub, { title: 'deadline' }, { ttlSeconds: 100, urgency: 'high', timeoutMs: 25 }));
  await flushContinuations();
  assert.equal(requests.length, 1, 'the network deadline case must reach HTTPS after real encryption');
  const active = requests[0];
  assert.equal(active.options.headers['Content-Encoding'], 'aes128gcm');
  assert.match(active.options.headers.Authorization, /^vapid /);
  await advance(t, 24);
  assert.ok(active.packets > 0, 'the response is continuously sending data before the deadline');
  assert.equal(active.request.destroyed, false); assert.equal(pending.settled, false);
  await advance(t, 1);
  assert.equal(active.request.destroyed, true, 'data arriving repeatedly must not extend the total deadline');
  assert.equal(pending.settled, true);
  assert.equal((await pending.promise).kind, 'retry');
  assert.equal(pending.completedAt - startedAt, 25);
});

test('total deadline covers DNS or connect before the first response', async t => {
  const { sender, requests } = useTransportFixture(t, 'dns');
  const startedAt = Date.now();
  const pending = observe(sender.send(sub, {}, { ttlSeconds: 100, urgency: 'high', timeoutMs: 25 }));
  await advance(t, 24);
  assert.equal(requests.length, 1); assert.equal(requests[0].responseStarted, false);
  assert.equal(requests[0].request.destroyed, false); assert.equal(pending.settled, false);
  await advance(t, 1);
  assert.equal(requests[0].request.destroyed, true);
  assert.equal(pending.settled, true); assert.equal((await pending.promise).kind, 'retry');
  assert.equal(pending.completedAt - startedAt, 25);
});

test('event expiry shortens the hard network deadline', async t => {
  const { sender, requests } = useTransportFixture(t);
  const startedAt = Date.now();
  const pending = observe(sender.send(sub, {}, { ttlSeconds: 100, urgency: 'high', timeoutMs: 100, expiresAtMs: startedAt + 15 }));
  await flushContinuations();
  await advance(t, 14);
  assert.equal(requests.length, 1); assert.equal(requests[0].request.destroyed, false);
  assert.equal(pending.settled, false);
  await advance(t, 1);
  assert.equal(requests[0].request.destroyed, true);
  assert.equal(pending.settled, true); assert.equal((await pending.promise).kind, 'retry');
  assert.equal(pending.completedAt - startedAt, 15);
});

test('shutdown abort destroys the request and hides the private reason', async t => {
  const { sender, requests } = useTransportFixture(t);
  const startedAt = Date.now(); const shutdown = new AbortController();
  setTimeout(() => shutdown.abort('private reason must not leak'), 10);
  const pending = observe(sender.send(sub, {}, { ttlSeconds: 100, urgency: 'high', timeoutMs: 100, signal: shutdown.signal }));
  await flushContinuations();
  await advance(t, 9);
  assert.equal(requests.length, 1); assert.equal(requests[0].request.destroyed, false);
  assert.equal(pending.settled, false);
  await advance(t, 1);
  assert.equal(requests[0].request.destroyed, true);
  assert.equal(pending.settled, true);
  const stopped = await pending.promise;
  assert.equal(stopped.kind, 'retry'); assert.equal(JSON.stringify(stopped).includes('private'), false);
  assert.equal(pending.completedAt - startedAt, 10);
});

test('an already aborted send does not start an HTTPS request', async t => {
  const { sender, requests } = useTransportFixture(t);
  const shutdown = new AbortController(); shutdown.abort('private reason must not leak');
  const pending = observe(sender.send(sub, {}, { ttlSeconds: 100, urgency: 'high', timeoutMs: 100, signal: shutdown.signal }));
  await flushContinuations();
  assert.equal(requests.length, 0, 'an already aborted send must not start a request');
  assert.equal(pending.settled, true);
  const stopped = await pending.promise;
  assert.equal(stopped.kind, 'retry'); assert.equal(JSON.stringify(stopped).includes('private'), false);
});

test('fast response succeeds and clears the hard deadline', async t => {
  const { sender, requests } = useTransportFixture(t, 'fast');
  const startedAt = Date.now();
  const pending = observe(sender.send(sub, {}, { ttlSeconds: 100, urgency: 'high', timeoutMs: 100 }));
  await flushContinuations();
  await advance(t, 1);
  assert.equal(requests.length, 1); assert.equal(pending.settled, false);
  await advance(t, 1);
  assert.equal(pending.settled, true); assert.equal((await pending.promise).kind, 'accepted');
  assert.equal(pending.completedAt - startedAt, 2);
  await advance(t, 100);
  assert.equal(requests[0].request.destroyed, false, 'a completed response must not be destroyed by a leftover deadline');
});

test('encryption preparation exhausting the deadline does not start an HTTPS request', async t => {
  const { sender, requests } = useTransportFixture(t);
  const startedAt = Date.now(); const original = webPush.generateRequestDetails;
  // Preserve the actual SDK encryption, then account for controlled synchronous
  // preparation time before deadlineTransport can start the network request.
  t.mock.method(webPush, 'generateRequestDetails', function (...args) {
    const details = original.apply(this, args);
    t.mock.timers.tick(60);
    return details;
  });
  const pending = observe(sender.send(sub, {}, { ttlSeconds: 100, urgency: 'high', timeoutMs: 25 }));
  await flushContinuations();
  assert.equal(Date.now() - startedAt, 60);
  assert.equal(requests.length, 0, 'expired preparation must not start a request with no budget left');
  assert.equal(pending.settled, true); assert.equal((await pending.promise).kind, 'retry');
  assert.equal(pending.completedAt - startedAt, 60);
});
