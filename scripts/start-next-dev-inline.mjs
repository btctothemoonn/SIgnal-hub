import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.__NEXT_DEV_SERVER = "1";
process.env.NEXT_PRIVATE_START_TIME = process.env.NEXT_PRIVATE_START_TIME || String(Date.now());

const require = createRequire(import.meta.url);
const { startServer } = require("next/dist/server/lib/start-server");
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await startServer({
  dir: projectRoot,
  hostname: "0.0.0.0",
  port: 3000,
  allowRetry: false,
  isDev: true,
  serverFastRefresh: true,
});

await new Promise(() => {});
