import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const bash = process.env.SIGNAL_HUB_TEST_BASH ?? (process.platform === 'win32'
  ? join(dirname(process.execPath), '..', '..', 'native', 'git', 'usr', 'bin', 'sh.exe') : 'bash');
if (process.platform === 'win32' && !existsSync(bash)) { console.log('skip - no bundled Bash for portable rollback-state check'); process.exit(0); }
const source = readFileSync(new URL('./deploy-vps.sh', import.meta.url), 'utf8');
const rollback = source.slice(source.indexOf('rollback() {'), source.indexOf('\ntrap rollback ERR'));
const root = mkdtempSync(join(tmpdir(), 'push-rollback-state-'));
try {
  mkdirSync(join(root, 'old', 'scripts'), { recursive: true });
  const fixture = `set -euo pipefail
previous_release="$PWD/old"
services=(signal-hub-web signal-hub-web-push)
scripts=("" web-push-worker.mjs)
printf 1 > enabled
printf 1 > active
sudo() { shift; systemctl "$@"; }
systemctl() {
  printf '%s\\n' "$*" >> commands
  case "$1" in
    stop) printf 0 > active ;;
    disable) printf 0 > enabled; if [[ "$2" == '--now' ]]; then printf 0 > active; fi ;;
  esac
}
activate() { printf '%s' "$1" > restored; }
${rollback}
rollback 9
`;
  writeFileSync(join(root, 'fixture.sh'), fixture);
  const run = spawnSync(bash, ['fixture.sh'], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 9, run.stderr);
  assert.equal(readFileSync(join(root, 'active'), 'utf8'), '0');
  assert.equal(readFileSync(join(root, 'enabled'), 'utf8'), '0', 'rollback must prevent the missing push worker from restarting at boot');
  assert.ok(readFileSync(join(root, 'restored'), 'utf8').endsWith('/old'));
  assert.doesNotMatch(readFileSync(join(root, 'commands'), 'utf8'), /^restart .*signal-hub-web-push/m);
} finally { rmSync(root, { recursive: true, force: true }); }
console.log('portable rollback preserves disabled missing-worker state');
