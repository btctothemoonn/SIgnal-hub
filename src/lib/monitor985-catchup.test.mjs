import assert from "node:assert/strict";
import {
  buildMonitor985CatchupSummary,
  getMonitor985CatchupLimit,
} from "./monitor985-catchup-policy.ts";

assert.equal(getMonitor985CatchupLimit({}, {}), 30);
assert.equal(getMonitor985CatchupLimit({ limit: 50 }, {}), 50);
assert.equal(getMonitor985CatchupLimit({}, { MONITOR985_MANUAL_CATCHUP_LIMIT: "80" }), 80);
assert.equal(getMonitor985CatchupLimit({ limit: 0 }, { MONITOR985_MANUAL_CATCHUP_LIMIT: "-1" }), 30);

assert.equal(
  buildMonitor985CatchupSummary({
    fetched: 34,
    accepted: 32,
    ignored: 2,
    accountSource: "985",
  }),
  "985 最新流已刷新：写入 32 条，忽略 2 条，来源 985，拉取 34 条。",
);

console.log("ok - monitor985 manual catchup helpers are bounded and readable");
