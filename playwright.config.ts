import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

const port = Number(process.env.SIGNAL_E2E_PORT || 3107);
const baseURL = `http://127.0.0.1:${port}`;
const password = process.env.SIGNAL_E2E_PASSWORD || randomBytes(24).toString("hex");
process.env.SIGNAL_E2E_PASSWORD = password;

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
      ADMIN_SESSION_SECRET: randomBytes(32).toString("hex"),
      ADMIN_COOKIE_SECURE: "false",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
