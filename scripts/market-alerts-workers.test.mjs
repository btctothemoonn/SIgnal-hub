import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const volRest = readFileSync(new URL("./market-volatility-rest-worker.mjs", import.meta.url), "utf8");
const volWs = readFileSync(new URL("./market-volatility-ws-worker.mjs", import.meta.url), "utf8");
const squeeze = readFileSync(new URL("./market-squeeze-worker.mjs", import.meta.url), "utf8");
const deploy = readFileSync(new URL("./deploy-vps.sh", import.meta.url), "utf8");
const localStart = readFileSync(new URL("./start-signal-hub.ps1", import.meta.url), "utf8");

assert.match(volRest, /runVolatilityRestScan/);
assert.match(volRest, /writeMarketAlertKlineChart/);
assert.match(volRest, /writeChart:\s*writeMarketAlertKlineChart/);
assert.match(volRest, /--once/);
assert.match(volWs, /startVolatilityWebSocketWorker/);
assert.match(volWs, /writeMarketAlertKlineChart/);
assert.match(volWs, /writeChart:\s*writeMarketAlertKlineChart/);
assert.match(volWs, /--once/);
assert.match(squeeze, /runSqueezeScan/);
assert.match(squeeze, /writeMarketAlertKlineChart/);
assert.match(squeeze, /writeChart:\s*writeMarketAlertKlineChart/);
assert.match(squeeze, /--once/);
assert.match(deploy, /signal-hub-market-volatility-rest/);
assert.match(deploy, /signal-hub-market-volatility-ws/);
assert.match(deploy, /signal-hub-market-squeeze/);
assert.match(localStart, /signal-hub-market-volatility-rest/);
assert.match(localStart, /signal-hub-market-squeeze/);

console.log("ok - market alert workers are launchable");
