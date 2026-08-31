import assert from "node:assert/strict";
import { primaryMobileNavItems } from "./app-shell-navigation.ts";

const items = [
  { key: "signals", label: "信号" },
  { key: "intel", label: "AI情报" },
  { key: "holding", label: "Holding" },
  { key: "stocks", label: "STOCKS" },
  { key: "douyin", label: "抖音" },
  { key: "settings", label: "设置" },
];

assert.deepEqual(
  primaryMobileNavItems(items).map((item) => item.key),
  ["signals", "intel", "holding", "stocks", "douyin"],
);
assert.deepEqual(items.map((item) => item.key), [
  "signals",
  "intel",
  "holding",
  "stocks",
  "douyin",
  "settings",
]);

console.log("ok - app shell mobile navigation keeps primary destinations only");
