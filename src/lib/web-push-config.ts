import { createECDH, ECDH } from 'node:crypto';
import type { EnvLike } from './important-push-types.ts';

export type ValidatedPushSubscription = { endpoint: string; expirationTime: number | null; keys: { p256dh: string; auth: string } };
export function decodePushKey(value: unknown, length: number) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid_key');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== length || bytes.toString('base64url') !== value) throw new Error('invalid_key');
  return bytes;
}
export function validatePushSubscription(input: unknown): ValidatedPushSubscription {
  if (!input || typeof input !== 'object') throw new Error('invalid_subscription');
  const data = input as Record<string, unknown>;
  if (typeof data.endpoint !== 'string' || data.endpoint.length > 4096) throw new Error('invalid_endpoint');
  const url = new URL(data.endpoint);
  if (url.protocol !== 'https:' || !['fcm.googleapis.com', 'web.push.apple.com'].includes(url.hostname) || url.username || url.password || url.hash || url.port) throw new Error('invalid_endpoint');
  const keys = data.keys as Record<string, unknown> | undefined;
  const publicBytes = decodePushKey(keys?.p256dh, 65);
  if (publicBytes[0] !== 4) throw new Error('invalid_key');
  ECDH.convertKey(publicBytes, 'prime256v1', undefined, undefined, 'uncompressed');
  decodePushKey(keys?.auth, 16);
  if (data.expirationTime != null && (typeof data.expirationTime !== 'number' || !Number.isFinite(data.expirationTime) || data.expirationTime < 0)) throw new Error('invalid_subscription');
  return { endpoint: url.href, expirationTime: data.expirationTime as number ?? null, keys: { p256dh: keys!.p256dh as string, auth: keys!.auth as string } };
}
export function getPushPublicOrigin(env: EnvLike = process.env): string | null {
  try {
    const url = new URL(env.SIGNAL_HUB_PUBLIC_ORIGIN ?? '');
    if (url.username || url.password || url.hash || url.search || url.pathname !== '/') return null;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return url.protocol === 'https:' || (local && env.NODE_ENV !== 'production' && url.protocol === 'http:') ? url.origin : null;
  } catch { return null; }
}
export function getWebPushConfig(env: EnvLike = process.env) {
  const enabled = env.WEB_PUSH_ENABLED === 'true';
  try {
    const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY ?? '';
    const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY ?? '';
    const subject = env.WEB_PUSH_VAPID_SUBJECT ?? '';
    const ec = createECDH('prime256v1'); ec.setPrivateKey(decodePushKey(privateKey, 32));
    if (!ec.getPublicKey().equals(decodePushKey(publicKey, 65))) throw new Error('invalid_vapid');
    const contact = new URL(subject);
    if (!['mailto:', 'https:'].includes(contact.protocol) || contact.username || contact.password || (contact.protocol === 'mailto:' && !/^[^\s@]+@[^\s@]+$/.test(contact.pathname))) throw new Error('invalid_subject');
    if (!getPushPublicOrigin(env)) throw new Error('invalid_origin');
    return { enabled, configured: true, publicKey, privateKey, subject, errorCode: null };
  } catch { return { enabled, configured: false, publicKey: null, privateKey: null, subject: null, errorCode: 'push_not_configured' }; }
}
