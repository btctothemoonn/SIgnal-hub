import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { createECDH, randomBytes } from 'node:crypto';
import { createWebPushSender } from './web-push-sender.ts';

const ec = createECDH('prime256v1'); ec.generateKeys();
const config = { enabled: true, configured: true, publicKey: ec.getPublicKey().toString('base64url'), privateKey: ec.getPrivateKey().toString('base64url'), subject: 'mailto:ops@example.com', errorCode: null };
const sub = { endpoint: 'https://fcm.googleapis.com/example', expirationTime: null, keys: { p256dh: config.publicKey, auth: randomBytes(16).toString('base64url') } };
const original = https.request;
let active = null, calls = 0, mode = 'slow';
https.request = (_url, options, callback) => {
  if (typeof options === 'function') { callback = options; options = _url; }
  calls++;
  const request = new EventEmitter(); const response = new EventEmitter();
  response.statusCode = 201; response.headers = {};
  response.resume = () => {}; response.destroy = () => {};
  request.destroyed = false; request.write = () => {};
  request.destroy = error => { request.destroyed = true; clearInterval(drip); clearTimeout(end); queueMicrotask(() => request.emit('error', error)); return request; };
  const drip = setInterval(() => response.emit('data', Buffer.from('x')), 2);
  const end = setTimeout(() => { clearInterval(drip); response.emit('end'); }, mode === 'fast' ? 2 : 180);
  request.end = () => { if (mode !== 'dns') queueMicrotask(() => callback(response)); };
  active = { request, options };
  return request;
};
try {
  const sender = createWebPushSender(config);
  const timed = await sender.send(sub, { title: 'deadline' }, { ttlSeconds: 100, urgency: 'high', timeoutMs: 25 });
  assert.equal(active.request.destroyed, true, 'a continuously dripping HTTPS response must be destroyed by the total deadline');
  assert.equal(timed.kind, 'retry');
  assert.equal(active.options.headers['Content-Encoding'], 'aes128gcm');
  assert.match(active.options.headers.Authorization, /^vapid /);
  mode = 'dns';
  assert.equal((await sender.send(sub, {}, { ttlSeconds: 100, urgency: 'high', timeoutMs: 25 })).kind, 'retry');
  assert.equal(active.request.destroyed, true, 'the total deadline also covers DNS/connect before any response');
  mode = 'slow';
  const expired = await sender.send(sub, {}, { ttlSeconds: 100, urgency: 'high', timeoutMs: 100, expiresAtMs: Date.now() + 15 });
  assert.equal(active.request.destroyed, true, 'event expiry shortens the hard deadline');
  assert.equal(expired.kind, 'retry');
  const shutdown = new AbortController();
  setTimeout(() => shutdown.abort('private reason must not leak'), 10);
  const stopped = await sender.send(sub, {}, { ttlSeconds: 100, urgency: 'high', timeoutMs: 100, signal: shutdown.signal });
  assert.equal(active.request.destroyed, true, 'shutdown aborts the underlying request');
  assert.equal(stopped.kind, 'retry'); assert.equal(JSON.stringify(stopped).includes('private'), false);
  const before = calls;
  await sender.send(sub, {}, { ttlSeconds: 100, urgency: 'high', timeoutMs: 100, signal: shutdown.signal });
  assert.equal(calls, before, 'an already aborted send must not start a request');
  mode = 'fast';
  const accepted = await sender.send(sub, {}, { ttlSeconds: 100, urgency: 'high', timeoutMs: 100 });
  assert.equal(accepted.kind, 'accepted');
} finally { https.request = original; }
console.log('web push absolute deadline and shutdown regressions passed');
