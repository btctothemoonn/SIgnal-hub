import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { createWebPushSender } from './web-push-sender.ts';
const ec = createECDH('prime256v1'); ec.generateKeys();
const config = { enabled: true, configured: true, publicKey: ec.getPublicKey().toString('base64url'), privateKey: ec.getPrivateKey().toString('base64url'), subject: 'mailto:ops@example.com', errorCode: null };
const sub = { endpoint: 'https://fcm.googleapis.com/example', expirationTime: null, keys: { p256dh: config.publicKey, auth: randomBytes(16).toString('base64url') } };
const options = { ttlSeconds: 100, urgency: 'high', timeoutMs: 10000 };
let calls = 0;
const sender = createWebPushSender(config, async (subscription, body, opts) => { calls++; assert.equal(opts.TTL, 100); assert.equal(opts.timeout, 10000); assert.equal(opts.contentEncoding, 'aes128gcm'); return { statusCode: 201 }; });
assert.equal((await sender.send(sub, { title: 'test' }, options)).kind, 'accepted');
assert.equal((await sender.send({ ...sub, endpoint: 'https://evil.test/a' }, {}, options)).kind, 'permanent_error'); assert.equal(calls, 1);
for (const [status, kind] of [[404, 'gone'], [410, 'gone'], [429, 'retry'], [503, 'retry'], [403, 'permanent_error'], [302, 'permanent_error']]) {
 const result = await createWebPushSender(config, async () => { throw { statusCode: status, headers: { 'retry-after': '17' }, body: 'secret endpoint and private material' }; }).send(sub, {}, options);
 assert.equal(result.kind, kind); if (status === 429) assert.equal(result.retryAfterMs, 17000);
 assert.equal(JSON.stringify(result).includes('secret'), false);
}
assert.equal((await createWebPushSender(config, async () => { throw new Error('network secrets'); }).send(sub, {}, options)).kind, 'retry');
console.log('web push sender tests passed');
