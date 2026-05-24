import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./deploy-vps.sh", import.meta.url), "utf8");

assert.match(source, /set -euo pipefail/);
assert.match(source, /git pull --ff-only origin/);
assert.match(source, /node_modules\/next\/dist\/bin\/next build/);
assert.match(source, /systemctl restart/);
assert.match(source, /signal-hub-web/);
assert.match(source, /signal-hub-stocks-cache/);
assert.match(source, /signal-hub-tiger-holdings/);
assert.match(source, /signal-hub-douyin/);

console.log("ok - vps deploy script contract");
