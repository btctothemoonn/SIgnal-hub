import { createHash, randomUUID } from 'node:crypto';
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from './admin-auth.ts';
import { getPushPublicOrigin, getWebPushConfig, validatePushSubscription } from './web-push-config.ts';
import { openWebPushStore, type WebPushStore, type DeviceBaseline } from './web-push-store.ts';
import { createWebPushSender, type WebPushSender } from './web-push-sender.ts';
import { capturePushBaseline, createNewsPushSource } from './web-push-worker.ts';
import { openMarketAlertsStore } from './market-alerts-store.ts';
import type { EnvLike, PushEvent } from './important-push-types.ts';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
function sessionToken(request: Request) { return request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${ADMIN_SESSION_COOKIE}=`))?.slice(ADMIN_SESSION_COOKIE.length + 1) ?? null; }
export function getPushRequestOrigin(request: Request, env: EnvLike = process.env) {
  const configured = getPushPublicOrigin(env); if (configured) return configured;
  const url = new URL(request.url); const host = request.headers.get('host');
  // The actual Host handles Next's localhost normalization. Forwarded host is never trusted.
  if (host && !/^[a-z0-9.:[\]-]+$/i.test(host)) return '';
  try { return new URL(`${url.protocol}//${host ?? url.host}`).origin; } catch { return ''; }
}
function checkRequest(request: Request, env: EnvLike, nowMs: number, mutation: boolean) {
  if (!verifyAdminSessionToken(sessionToken(request), env, nowMs)) return reply({ error: 'login_required' }, 401);
  if (mutation && request.headers.get('origin') !== getPushRequestOrigin(request, env)) return reply({ error: 'same_origin_required' }, 403);
  return null;
}
async function readBoundedText(request: Request) {
  if (Number(request.headers.get('content-length')) > 8192) throw new Error('body_too_large');
  const reader = request.body?.getReader(); if (!reader) return '';
  let length = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 8192) { await reader.cancel(); throw new Error('body_too_large'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message === 'body_too_large') return reply({ error: message }, 413);
  if (message === 'device_conflict') return reply({ error: message }, 409);
  if (message.startsWith('invalid_') || error instanceof SyntaxError || error instanceof TypeError) return reply({ error: 'invalid_request' }, 400);
  return reply({ error: 'push_control_failed' }, 500);
}
export function createWebPushApiHandlers(input: { store: WebPushStore; sender: WebPushSender; baselineProvider: (nowMs: number) => DeviceBaseline; env?: EnvLike; now?: () => number }) {
  const env = input.env ?? process.env; const now = input.now ?? Date.now;
  function device(request: Request) { return { deviceId: request.headers.get('X-Signal-Push-Device') ?? '', deviceKey: request.headers.get('X-Signal-Push-Device-Key') ?? '' }; }
  const protect = (handler: (request: Request) => Promise<Response> | Response, mutation: boolean) => async (request: Request) => { const denied = checkRequest(request, env, now(), mutation); if (denied) return denied; try { return await handler(request); } catch (error) { return errorResponse(error); } };
  return {
    config: protect(() => { const { enabled, configured, publicKey } = getWebPushConfig(env); return reply({ enabled, configured, publicKey }); }, false),
    getSubscriptionStatus: protect(request => { const proof = device(request); const status = input.store.getDeviceStatus(proof.deviceId, proof.deviceKey); return status ? reply(status) : reply({ error: 'device_proof_required' }, 403); }, false),
    subscribe: protect(async request => {
      const config = getWebPushConfig(env); if (!config.enabled || !config.configured) return reply({ error: 'push_not_configured' }, 503);
      const key = createHash('sha256').update(sessionToken(request) ?? '').digest('hex');
      if (!input.store.consumeControlBudget({ key: `enroll:${key}`, limit: 10, windowMs: 60000, nowMs: now() })) return reply({ error: 'control_rate_limited' }, 429);
      if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'json_required' }, 415);
      const body = JSON.parse(await readBoundedText(request));
      if (!body || typeof body.deviceId !== 'string' || typeof body.deviceKey !== 'string') return reply({ error: 'invalid_device' }, 400);
      const subscription = validatePushSubscription(body.subscription); const nowMs = now();
      return reply(input.store.enrollDevice({ subscription, device: { deviceId: body.deviceId, deviceKey: body.deviceKey }, baseline: input.baselineProvider(nowMs), nowMs }));
    }, true),
    unsubscribe: protect(request => { const proof = device(request); return input.store.revokeDevice(proof.deviceId, proof.deviceKey, now()) ? reply({ success: true }) : reply({ error: 'device_proof_required' }, 403); }, true),
    testPush: protect(async request => {
      const proof = device(request); const subscription = input.store.getSubscriptionForControl(proof.deviceId, proof.deviceKey);
      const enrolled = input.store.getDeviceStatus(proof.deviceId, proof.deviceKey);
      if (!subscription) return reply({ error: 'device_proof_required' }, 403);
      if (!getWebPushConfig(env).enabled || !getWebPushConfig(env).configured) return reply({ error: 'push_not_configured' }, 503);
      if (!input.store.consumeControlBudget({ key: `test:${proof.deviceId}`, limit: 3, windowMs: 60000, nowMs: now() })) return reply({ error: 'control_rate_limited' }, 429);
      const at = now(); const id = `test:${randomUUID()}`;
      const payload: PushEvent = { id, episodeId: id, source: 'test', stage: 'test', priority: 1, title: 'Signal Hub 测试通知', body: '通知连接测试，请确认当前设备能看到这条提醒。', target: '/settings', occurredAt: new Date(at).toISOString(), expiresAt: new Date(at + 60000).toISOString(), sourcePublishedAt: null, ruleVersion: 'test', evidence: [] };
      const result = await input.sender.send(subscription, payload, { ttlSeconds: 60, urgency: 'normal', timeoutMs: 10000 });
      if (result.kind === 'gone' && enrolled) input.store.invalidateSubscription({ deviceId: proof.deviceId, epoch: enrolled.epoch, nowMs: now() });
      return result.kind === 'accepted' ? reply({ accepted: true }) : reply({ error: result.errorCode ?? 'test_not_accepted', accepted: false }, 502);
    }, true),
  };
}
export async function withWebPushApi(method: keyof ReturnType<typeof createWebPushApiHandlers>, request: Request) {
  const store = openWebPushStore();
  try {
    return await createWebPushApiHandlers({ store, sender: createWebPushSender(getWebPushConfig()), baselineProvider: nowMs => { const market = openMarketAlertsStore(); try { return capturePushBaseline(market, createNewsPushSource(), nowMs); } finally { market.close(); } } })[method](request);
  } finally { store.close(); }
}
export async function revokePushForLogout(request: Request, options: { env?: EnvLike; now?: () => number; store?: WebPushStore } = {}): Promise<Response | null> {
  const env = options.env ?? process.env; const now = options.now ?? Date.now;
  // Expired sessions still sign out, but never revoke a surviving background subscription.
  if (!verifyAdminSessionToken(sessionToken(request), env, now())) return null;
  try {
    const fields = new URLSearchParams(await readBoundedText(request));
    const deviceId = fields.get('pushDeviceId'), deviceKey = fields.get('pushDeviceKey');
    if (!deviceId || !deviceKey) return null;
    const denied = checkRequest(request, env, now(), true); if (denied) return denied;
    const store = options.store ?? openWebPushStore();
    try { store.revokeDevice(deviceId, deviceKey, now()); } finally { if (!options.store) store.close(); }
    return null;
  } catch (error) { return errorResponse(error); }
}
