import { randomBytes } from "node:crypto";
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from "@playwright/test";

const port = Number(process.env.SIGNAL_E2E_PORT || 3107);
const baseURL = `http://127.0.0.1:${port}`;
const password = process.env.SIGNAL_E2E_PASSWORD || randomBytes(24).toString("hex");
process.env.SIGNAL_E2E_PASSWORD = password;
const sessionSecret = process.env.SIGNAL_E2E_SESSION_SECRET || randomBytes(32).toString("hex");
process.env.SIGNAL_E2E_SESSION_SECRET = sessionSecret;
const runtimeDir = process.env.SIGNAL_E2E_RUNTIME_DIR || mkdtempSync(join(tmpdir(), 'signal-browser-runtime-'));
process.env.SIGNAL_E2E_RUNTIME_DIR = runtimeDir;
process.env.DAILY_BRIEF_DB = join(runtimeDir, 'brief.sqlite');

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 60_000,
  use: { baseURL, channel: "chrome", screenshot: "only-on-failure" },
  webServer: {
    command: `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p ${port}`,
    url: `${baseURL}/login`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      ADMIN_PASSWORD: password,
      ADMIN_SESSION_SECRET: sessionSecret,
      ADMIN_COOKIE_SECURE: "false",
      NEXT_TELEMETRY_DISABLED: "1",
      SIGNAL_HUB_RUNTIME_DIR: runtimeDir,
      MARKET_ALERTS_DB: join(runtimeDir, 'market.sqlite'),
      DAILY_BRIEF_DB: process.env.DAILY_BRIEF_DB,
      WEB_PUSH_ENABLED: 'false',
    },
  },
});
