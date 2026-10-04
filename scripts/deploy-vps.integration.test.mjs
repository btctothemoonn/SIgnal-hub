import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "linux") {
  console.log("skip - release integration runs on Linux with systemd commands replaced by local test doubles");
  process.exit(0);
}
const source = readFileSync(new URL("./deploy-vps.sh", import.meta.url), "utf8");
for (const [failure, wecomEnabled, pushEnabled, oldPush, hybridEnabled = "1"] of [["none", "1", "1", false], ["none", "0", "0", false, "0"], ["build", "1", "1", false], ["readiness", "1", "1", false], ["readiness", "1", "1", true], ["transient-service", "1", "1", false], ["failed-service", "1", "1", false]]) {
  const root = mkdtempSync(join(tmpdir(), "signal-release-test-"));
  try {
    const app = join(root, "app");
    const bin = join(root, "bin");
    const old = join(root, "old");
    const current = join(root, "current");
    for (const dir of [join(app, "scripts"), join(app, ".signal-hub"), bin, old]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(app, "scripts/deploy-vps.sh"), source);
    writeFileSync(join(app, "scripts/web-push-worker.mjs"), "// fixture worker");
    if (oldPush) { mkdirSync(join(old, "scripts")); writeFileSync(join(old, "scripts/web-push-worker.mjs"), "// older worker"); }
    writeFileSync(join(app, ".signal-hub/marker"), "preserve runtime");
    symlinkSync(old, current);
    const run = (command, args) => {
      const result = spawnSync(command, args, { cwd: app, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    };
    run("git", ["init", "-q"]);
    run("git", ["add", "scripts"]);
    run("git", ["-c", "user.name=Release Test", "-c", "user.email=release@test.invalid", "commit", "-qm", "fixture"]);
    const executable = (name, body) => writeFileSync(join(bin, name), `#!/usr/bin/env bash\nset -e\n${body}\n`, { mode: 0o755 });
    executable("pnpm", "exit 0");
    executable("sleep", "exit 0");
    executable("systemctl", `printf "%s\\n" "$*" >> "$TEST_SERVICES_LOG"
case "$1" in
  enable) for service in "\${@:2}"; do printf 1 > "$TEST_ENABLED_DIR/$service"; done ;;
  disable) for service in "\${@:2}"; do [[ "$service" == '--now' ]] || printf 0 > "$TEST_ENABLED_DIR/$service"; done ;;
esac
if [[ "$1" == "is-active" && "$3" == "signal-hub-x-hybrid" ]]; then
  if [[ "$TEST_FAILURE" == "failed-service" ]]; then exit 3; fi
  if [[ "$TEST_FAILURE" == "transient-service" && ! -f "$TEST_SERVICES_LOG.recovered" ]]; then
    touch "$TEST_SERVICES_LOG.recovered"
    exit 3
  fi
fi`);
    executable("sudo", 'if [[ "$1" == "tee" ]]; then cat >> "$TEST_UNITS_LOG"; elif [[ "$1" == "systemctl" ]]; then shift; systemctl "$@"; fi');
    executable("node", `
case "$*" in
  *"WECOM_SYNC_ENABLED"*) [[ "$TEST_WECOM_ENABLED" == "1" ]] || exit 1 ;;
  *"WEB_PUSH_ENABLED"*) [[ "$TEST_PUSH_ENABLED" == "1" ]] || exit 1 ;;
  *"X_HYBRID_ENABLED"*) [[ "$TEST_HYBRID_ENABLED" == "1" ]] || exit 1 ;;
  *"TWITTER_CONNECTOR_ENABLED"*) [[ "$TEST_HYBRID_ENABLED" == "1" ]] || exit 1 ;;
  *"next build"*)
    [[ "$(readlink -f "$SIGNAL_HUB_CURRENT_LINK")" == "$TEST_OLD_RELEASE" ]]
    [[ ! -L .signal-hub ]] || exit 32
    [[ "$TEST_FAILURE" != "build" ]] || exit 8
    mkdir -p .next
    ;;
  *"check-deployment.mjs"*) [[ "$TEST_FAILURE" != "readiness" ]] || exit 9 ;;
esac`);
    mkdirSync(join(root, 'enabled'));
    writeFileSync(join(root, 'enabled/signal-hub-web-push'), oldPush ? '1' : '0');
    writeFileSync(join(root, 'enabled/signal-hub-x-hybrid'), '1');
    writeFileSync(join(root, 'enabled/signal-hub-x-pipeline'), '1');
    const result = spawnSync("bash", [join(app, "scripts/deploy-vps.sh")], {
      cwd: app, encoding: "utf8", timeout: 30_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SIGNAL_HUB_APP_DIR: app,
        SIGNAL_HUB_RELEASES_DIR: join(root, "releases"), SIGNAL_HUB_CURRENT_LINK: current,
        SIGNAL_HUB_NODE_BIN: join(bin, "node"), SIGNAL_HUB_PNPM_BIN: join(bin, "pnpm"),
        SIGNAL_HUB_DEPLOY_REEXEC: "1", TEST_FAILURE: failure, TEST_OLD_RELEASE: old,
        TEST_WECOM_ENABLED: wecomEnabled, TEST_PUSH_ENABLED: pushEnabled, TEST_HYBRID_ENABLED: hybridEnabled, TEST_ENABLED_DIR: join(root, 'enabled'), TEST_SERVICES_LOG: join(root,"services.log"), TEST_UNITS_LOG: join(root,"units.log") },
    });
    const success = failure === "none" || failure === "transient-service";
    assert.equal(result.status, success ? 0 : failure === "build" ? 8 : failure === "failed-service" ? 1 : 9, result.stdout + result.stderr);
    if (success) {
      assert.notEqual(realpathSync(current), old);
      assert.equal(realpathSync(join(current, ".signal-hub")), join(app, ".signal-hub"));
      const services = readFileSync(join(root,"services.log"),"utf8");
      const units = readFileSync(join(root,"units.log"),"utf8");
      assert.equal(/^restart .*signal-hub-wecom-receiver/m.test(services), wecomEnabled === "1");
      assert.equal(/^restart .*signal-hub-web-push/m.test(services), pushEnabled === "1");
      if (pushEnabled === "0") assert.match(services, /disable --now signal-hub-web-push/);
      assert.equal(readFileSync(join(root, 'enabled/signal-hub-web-push'), 'utf8'), pushEnabled);
      assert.equal(/^restart .*signal-hub-x-hybrid/m.test(services), hybridEnabled === "1");
      if (hybridEnabled === "0") {
        assert.equal(readFileSync(join(root, 'enabled/signal-hub-x-hybrid'), 'utf8'), '0');
        assert.equal(readFileSync(join(root, 'enabled/signal-hub-x-pipeline'), 'utf8'), '0');
      }
      if (wecomEnabled === "1") {
        assert.match(units, /MemoryMax=192M/);
        assert.match(units, /CPUQuota=25%/);
        assert.match(units, /ReadWritePaths=.*\.signal-hub/);
      } else {
        assert.match(services, /stop signal-hub-wecom-receiver/);
      }
    } else {
      assert.equal(realpathSync(current), old, "a failed build or startup must keep/restore the old release");
      if (failure !== "build") {
        const services = readFileSync(join(root, "services.log"), "utf8");
        const restarts = services.split('\n').filter(line => line.startsWith('restart '));
        assert.equal(restarts.at(-1).includes('signal-hub-web-push'), oldPush && pushEnabled === '1');
        if (!oldPush) {
          assert.ok(services.lastIndexOf('disable --now signal-hub-web-push') < services.lastIndexOf('restart '), 'disable unavailable worker before restarting old services');
          assert.equal(readFileSync(join(root, 'enabled/signal-hub-web-push'), 'utf8'), '0', 'missing worker stays disabled after reboot');
        }
      }
    }
    assert.equal(readFileSync(join(app, ".signal-hub/marker"), "utf8"), "preserve runtime");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
console.log("ok - release activation, failed build isolation, and startup rollback");
