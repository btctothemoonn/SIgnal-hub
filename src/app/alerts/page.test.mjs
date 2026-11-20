import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
assert.match(read("./page.tsx"), /MarketFocusPage market="crypto"/);
assert.match(read("./equities/page.tsx"), /MarketFocusPage market="equities"/);
const source = read("../../components/market-focus-page.tsx");

assert.match(source, /activeNav="alerts"/);
assert.match(source, /MarketSignalsBoard/);
assert.match(source, /getMarketSignalsBoardData/);
assert.match(source, /重点观察/);
assert.match(source, /getBoardWorkerHealth/);
assert.match(source, /观察市场/);

const board = readFileSync(new URL("../../components/market-signals-board.tsx", import.meta.url), "utf8");
assert.match(board, /\/api\/market-signals/);
assert.doesNotMatch(board, /\/alerts\/legacy|全部异动|完整记录入口/);
assert.match(board, /突发异动/);
assert.match(board, /market-alert-watchlist/, "keeps the existing watchlist storage key");
assert.doesNotMatch(board, /仅美股|含美股商品/);

console.log("ok - alerts page renders the signals board");
