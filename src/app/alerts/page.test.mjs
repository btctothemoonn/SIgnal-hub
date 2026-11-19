import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(source, /activeNav="alerts"/);
assert.match(source, /MarketSignalsBoard/);
assert.match(source, /getMarketSignalsBoardData/);
assert.match(source, /启动候选与大涨后转弱/);
assert.match(source, /4 在线/);
assert.match(source, /liveWorkers === 4/);

const board = readFileSync(new URL("../../components/market-signals-board.tsx", import.meta.url), "utf8");
assert.match(board, /\/api\/market-signals/);
assert.match(board, /\/alerts\/legacy/);
assert.match(board, /方向未定，不是做多信号/);
assert.match(board, /market-alert-watchlist/, "keeps the existing watchlist storage key");
assert.match(board, /仅美股/);
assert.doesNotMatch(board, /含美股商品/);

console.log("ok - alerts page renders the signals board");
