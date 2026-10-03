import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { openWebPushStore } from '../src/lib/web-push-store.ts';
const dir = mkdtempSync(join(tmpdir(), 'push-disabled-'));
try {
 const result = spawnSync(process.execPath, ['--experimental-strip-types', '--experimental-transform-types', 'scripts/web-push-worker.mjs', '--once'], { env: { ...process.env, WEB_PUSH_ENABLED: 'false', SIGNAL_HUB_RUNTIME_DIR: dir }, encoding: 'utf8' });
 assert.equal(result.status, 0, result.stderr);
 const store = openWebPushStore(join(dir, 'web-push.sqlite'));
 assert.equal(store.readWorkerHealth().status, 'disabled'); store.close();
 assert.equal(result.stdout.includes('privateKey'), false);
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log('disabled push worker runtime tests passed');
