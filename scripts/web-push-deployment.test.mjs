import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWebPushStore } from '../src/lib/web-push-store.ts';
import { webPushHealthItem } from '../src/lib/system-health.ts';
import { getEnabledSignalHubSystemdServices } from '../src/lib/signal-hub-services.ts';
const dir = mkdtempSync(join(tmpdir(), 'push-health-')); const now = new Date('2026-10-02T02:00:00Z');
const ec = createECDH('prime256v1'); ec.generateKeys();
const env = { SIGNAL_HUB_RUNTIME_DIR: dir, WEB_PUSH_ENABLED: 'true', WEB_PUSH_VAPID_PUBLIC_KEY: ec.getPublicKey().toString('base64url'), WEB_PUSH_VAPID_PRIVATE_KEY: ec.getPrivateKey().toString('base64url'), WEB_PUSH_VAPID_SUBJECT: 'mailto:ops@example.com', SIGNAL_HUB_PUBLIC_ORIGIN: 'https://hub.example.com' };
try {
 assert.equal(webPushHealthItem({ ...env, WEB_PUSH_ENABLED: 'false' }, now).status, 'ok');
 assert.equal(webPushHealthItem({ ...env, WEB_PUSH_VAPID_PRIVATE_KEY: '' }, now).status, 'error');
 const store = openWebPushStore(join(dir, 'web-push.sqlite'));
 store.setWorkerHealth({ status: 'live', updatedAt: now.toISOString(), errorCode: null, counts: { sent: 8, pending: 4 } });
 assert.equal(webPushHealthItem(env, now).status, 'ok');
 assert.equal(webPushHealthItem(env, new Date(now.getTime() + 31000)).status, 'warning');
 store.setWorkerHealth({ status: 'error', updatedAt: now.toISOString(), errorCode: 'push_auth_failed', counts: {} });
 assert.equal(webPushHealthItem(env, now).status, 'error');
 assert.equal(JSON.stringify(webPushHealthItem(env, now)).includes(env.WEB_PUSH_VAPID_PRIVATE_KEY), false);
 store.close();
 assert.equal(getEnabledSignalHubSystemdServices({}).some(s => s.name === 'signal-hub-web-push'), false);
 assert.equal(getEnabledSignalHubSystemdServices(env).some(s => s.name === 'signal-hub-web-push'), true);
 const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
 assert.ok(pkg.scripts['push:worker:once'].includes('--once'));
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log('optional push service and health tests passed');
