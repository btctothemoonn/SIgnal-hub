#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  getSystemHealthSnapshot,
  systemHealthStatusRank,
} from "../src/lib/system-health.ts";
import { SIGNAL_HUB_SYSTEMD_SERVICES } from "../src/lib/signal-hub-services.ts";

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const json = args.has("--json");

function systemctlIsActive({ label, name }) {
  return new Promise((resolve) => {
    execFile(
      "systemctl",
      ["is-active", name],
      { timeout: 1200 },
      (error, stdout, stderr) => {
        const activeState = stdout.trim() || (error ? "unknown" : "active");
        const detail = stderr.trim() || (error instanceof Error ? error.message : "");
        resolve({ name, label, activeState, ...(detail ? { detail } : {}) });
      },
    );
  });
}

async function readSystemdServiceStates() {
  if (process.platform !== "linux") return [];
  return Promise.all(SIGNAL_HUB_SYSTEMD_SERVICES.map(systemctlIsActive));
}

function lineForItem(item) {
  const stale = item.stale ? " stale" : "";
  const updated = item.updatedAt ? ` updated=${item.updatedAt}` : "";
  return `[${item.status}] ${item.label}: ${item.detail}${stale}${updated}`;
}

const serviceStates = await readSystemdServiceStates();
const snapshot = await getSystemHealthSnapshot({ serviceStates });

if (json) {
  console.log(JSON.stringify(snapshot, null, 2));
} else {
  console.log(`Signal Hub health: ${snapshot.status} @ ${snapshot.generatedAt}`);
  for (const item of [...snapshot.items].sort((left, right) => {
    return (
      systemHealthStatusRank(right.status) - systemHealthStatusRank(left.status) ||
      left.label.localeCompare(right.label)
    );
  })) {
    console.log(lineForItem(item));
  }
}

const hasError = snapshot.items.some((item) => item.status === "error");
const hasWarning = snapshot.items.some((item) => item.status === "warning");
if (hasError || (strict && hasWarning)) {
  process.exitCode = 1;
}
