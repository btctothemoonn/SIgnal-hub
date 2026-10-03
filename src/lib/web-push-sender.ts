import webPush from 'web-push';
import https from 'node:https';
import { getWebPushConfig, validatePushSubscription, type ValidatedPushSubscription } from './web-push-config.ts';
import type { PushEvent } from './important-push-types.ts';
export type SendOutcome = { kind: 'accepted' | 'gone' | 'retry' | 'permanent_error'; statusCode: number | null; retryAfterMs: number | null; errorCode: string | null };
type SendOptions = { ttlSeconds: number; urgency: 'high' | 'normal'; timeoutMs: number; expiresAtMs?: number; signal?: AbortSignal };
type TransportControl = { deadlineAt: number; signal?: AbortSignal };
type Transport = (subscription: ValidatedPushSubscription, payload: string, options: webPush.RequestOptions, control: TransportControl) => Promise<{ statusCode: number; headers?: Record<string, string | string[] | undefined> }>;
const deadlineTransport: Transport = async (subscription, payload, options, control) => {
  const details = webPush.generateRequestDetails(subscription, payload, options);
  return new Promise((resolve, reject) => {
    let request: ReturnType<typeof https.request> | undefined;
    const timer = setTimeout(() => stop('push_transport_timeout'), Math.max(0, control.deadlineAt - Date.now()));
    let settled = false;
    const finish = (error: Error | null, result?: { statusCode: number; headers: Record<string, string | string[] | undefined> }) => {
      if (settled) return;
      settled = true; clearTimeout(timer); control.signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result!);
    };
    const stop = (code: string) => {
      const error = new Error(code);
      request?.destroy(error);
      finish(error);
    };
    const abort = () => stop('push_shutdown');
    if (control.signal?.aborted) { abort(); return; }
    const remaining = control.deadlineAt - Date.now();
    if (remaining <= 0) { stop('push_transport_timeout'); return; }
    control.signal?.addEventListener('abort', abort, { once: true });
    try {
      request = https.request(details.endpoint, { method: details.method, headers: details.headers }, response => {
        // Discard provider bodies; the hard timer remains active through response completion.
        response.once('error', error => { request?.destroy(); finish(error); });
        response.once('aborted', () => stop('push_response_aborted'));
        response.once('close', () => { if (!settled) stop('push_response_incomplete'); });
        response.once('end', () => finish(null, { statusCode: response.statusCode ?? 0, headers: response.headers }));
        response.resume();
      });
      request.once('error', error => finish(error));
      if (details.body) request.write(details.body);
      request.end();
    } catch (error) { request?.destroy(); finish(error instanceof Error ? error : new Error('push_transport_failed')); }
  });
};
export function createWebPushSender(config: ReturnType<typeof getWebPushConfig>, transport: Transport = deadlineTransport) {
  function outcome(statusCode: number | null, headers?: Record<string, string | string[] | undefined>): SendOutcome {
    if (statusCode != null && statusCode >= 200 && statusCode < 300) return { kind: 'accepted', statusCode, retryAfterMs: null, errorCode: null };
    if (statusCode === 404 || statusCode === 410) return { kind: 'gone', statusCode, retryAfterMs: null, errorCode: 'push_gone' };
    if (statusCode === null || statusCode === 429 || statusCode >= 500) {
      const raw = headers?.['retry-after']; const value = Array.isArray(raw) ? raw[0] : raw;
      const delay = value && /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : value ? Date.parse(value) - Date.now() : NaN;
      return { kind: 'retry', statusCode, retryAfterMs: Number.isFinite(delay) ? Math.max(0, delay) : null, errorCode: statusCode === 429 ? 'push_rate_limited' : 'push_temporarily_unavailable' };
    }
    return { kind: 'permanent_error', statusCode, retryAfterMs: null, errorCode: statusCode === 401 || statusCode === 403 ? 'push_auth_failed' : 'push_rejected' };
  }
  return { async send(subscription: ValidatedPushSubscription, payload: PushEvent, options: SendOptions): Promise<SendOutcome> {
    if (!config.enabled || !config.configured || !config.publicKey || !config.privateKey || !config.subject) return { kind: 'permanent_error', statusCode: null, retryAfterMs: null, errorCode: 'push_not_configured' };
    let validated: ValidatedPushSubscription;
    try { validated = validatePushSubscription(subscription); } catch { return { kind: 'permanent_error', statusCode: null, retryAfterMs: null, errorCode: 'invalid_subscription' }; }
    if (options.ttlSeconds <= 0) return { kind: 'permanent_error', statusCode: null, retryAfterMs: null, errorCode: 'event_expired' };
    try {
      const timeout = Math.min(10000, options.timeoutMs, options.ttlSeconds * 1000);
      const deadlineAt = Math.min(Date.now() + timeout, options.expiresAtMs ?? Infinity);
      const response = await transport(validated, JSON.stringify(payload), { TTL: Math.floor(options.ttlSeconds), urgency: options.urgency, timeout, contentEncoding: 'aes128gcm', vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey } }, { deadlineAt, signal: options.signal });
      return outcome(response.statusCode, response.headers);
    } catch (error) {
      const safe = error as { statusCode?: unknown; headers?: Record<string, string | string[] | undefined> };
      return outcome(typeof safe?.statusCode === 'number' ? safe.statusCode : null, safe?.headers);
    }
  } };
}
export type WebPushSender = ReturnType<typeof createWebPushSender>;
