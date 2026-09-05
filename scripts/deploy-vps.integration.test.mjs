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
for (const failure of ["none", "build", "readiness"]) {
  const root = mkdtempSync(join(tmpdir(), "signal-release-test-"));
  try {
    const app = join(root, "app");
    const bin = join(root, "bin");
    const old = join(root, "old");
    const current = join(root, "current");
    for (const dir of [join(app, "scripts"), join(app, ".signal-hub"), bin, old]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(app, "scripts/deploy-vps.sh"), source);
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
    executable("systemctl", "exit 0");
    executable("sudo", 'if [[ "$1" == "tee" ]]; then cat >/dev/null; elif [[ "$1" == "systemctl" ]]; then shift; systemctl "$@"; fi');
    executable("node", `
case "$*" in
  *"next build"*)
    [[ "$(readlink -f "$SIGNAL_HUB_CURRENT_LINK")" == "$TEST_OLD_RELEASE" ]]
    [[ ! -L .signal-hub ]] || exit 32
    [[ "$TEST_FAILURE" != "build" ]] || exit 8
    mkdir -p .next
    ;;
  *"check-deployment.mjs"*) [[ "$TEST_FAILURE" != "readiness" ]] || exit 9 ;;
esac`);
    const result = spawnSync("bash", [join(app, "scripts/deploy-vps.sh")], {
      cwd: app, encoding: "utf8", timeout: 30_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SIGNAL_HUB_APP_DIR: app,
        SIGNAL_HUB_RELEASES_DIR: join(root, "releases"), SIGNAL_HUB_CURRENT_LINK: current,
        SIGNAL_HUB_NODE_BIN: join(bin, "node"), SIGNAL_HUB_PNPM_BIN: join(bin, "pnpm"),
        SIGNAL_HUB_DEPLOY_REEXEC: "1", TEST_FAILURE: failure, TEST_OLD_RELEASE: old },
    });
    assert.equal(result.status, failure === "none" ? 0 : failure === "build" ? 8 : 9, result.stdout + result.stderr);
    if (failure === "none") {
      assert.notEqual(realpathSync(current), old);
      assert.equal(realpathSync(join(current, ".signal-hub")), join(app, ".signal-hub"));
    } else {
      assert.equal(realpathSync(current), old, "a failed build or startup must keep/restore the old release");
    }
    assert.equal(readFileSync(join(app, ".signal-hub/marker"), "utf8"), "preserve runtime");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
console.log("ok - release activation, failed build isolation, and startup rollback");
