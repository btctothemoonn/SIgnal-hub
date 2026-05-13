import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const launcher = readFileSync(
  new URL("./start-signal-hub.ps1", import.meta.url),
  "utf8",
);
const shortcut = readFileSync(
  new URL("./create-desktop-shortcut.ps1", import.meta.url),
  "utf8",
);

assert.match(
  launcher,
  /\[switch\]\$WithWorkers/,
  "local launcher must require an explicit -WithWorkers switch",
);
assert.match(
  launcher,
  /function Stop-ManagedNodeProcess/,
  "local launcher must stop stale worker processes by default",
);
assert.match(
  launcher,
  /if \(-not \$WithWorkers\) \{[\s\S]*signal-hub-telegram[\s\S]*signal-hub-x-hybrid[\s\S]*signal-hub-monitor985[\s\S]*signal-hub-alpha-summary[\s\S]*\} else \{/,
  "worker startup must be gated behind -WithWorkers",
);
assert.doesNotMatch(
  shortcut,
  /Telegram worker, and X worker/,
  "desktop shortcut description must not claim that local workers start by default",
);

console.log("ok - local launcher keeps workers off by default");
