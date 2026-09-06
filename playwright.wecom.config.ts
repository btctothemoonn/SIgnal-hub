import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const port = Number(process.env.SIGNAL_WECOM_E2E_PORT ?? 3119);
const receiverPort = Number(process.env.SIGNAL_WECOM_E2E_RECEIVER_PORT ?? 3049);
mkdirSync(join(process.cwd(), ".codex-tools"), { recursive: true });
const directory = process.env.SIGNAL_WECOM_E2E_RUNTIME ?? mkdtempSync(join(process.cwd(), ".codex-tools", "wecom-e2e-"));
process.env.SIGNAL_WECOM_E2E_RUNTIME = directory;
process.env.SIGNAL_E2E_PASSWORD = "synthetic-wecom-password";
const env = {
  SIGNAL_HUB_RUNTIME_DIR: directory,
  ADMIN_PASSWORD: process.env.SIGNAL_E2E_PASSWORD,
  ADMIN_SESSION_SECRET: "synthetic-wecom-browser-session-secret",
  ADMIN_COOKIE_SECURE: "false",
  WECOM_SYNC_ENABLED: "true",
  WECOM_OWNER_ADMIN_ONLY: "true",
  WECOM_SYNC_DEVICE_ID: "mac-synthetic",
  WECOM_SYNC_SECRET: "TEST-ONLY-wecom-cross-language-synthetic-secret",
  WECOM_RECEIVER_PORT: String(receiverPort),
  NEXT_TELEMETRY_DISABLED: "1",
};
export default defineConfig({
  reporter: [["list"], ["json", { outputFile: ".codex-tools/wecom-e2e-results.json" }]],
  testDir: "./e2e", testMatch: "wecom.spec.ts", workers: 1, timeout: 90_000,
  use: { baseURL: `http://127.0.0.1:${port}`, channel: "chrome", screenshot: "only-on-failure" },
  webServer: [
    { command: "node --experimental-strip-types --experimental-transform-types scripts/wecom-receiver.mjs", url: `http://127.0.0.1:${receiverPort}/health`, reuseExistingServer: false, env },
    { command: `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p ${port}`, url: `http://127.0.0.1:${port}/login`, timeout: 60_000, reuseExistingServer: false, env },
  ],
});
