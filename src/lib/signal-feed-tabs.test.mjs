import assert from "node:assert/strict";

const {
  getXSourceBadgeLabel,
  isMergedXSignalSource,
  matchesSignalFeedTab,
  matchesSignalFeedCollector,
} = await import("./signal-feed-tabs.ts");

assert.equal(isMergedXSignalSource("x"), true);
assert.equal(isMergedXSignalSource("monitor985"), true);
assert.equal(isMergedXSignalSource("truth"), false);
assert.equal(isMergedXSignalSource("telegram"), false);

assert.equal(matchesSignalFeedTab({ source: "x" }, "x"), true);
assert.equal(matchesSignalFeedTab({ source: "monitor985" }, "x"), true);
assert.equal(matchesSignalFeedTab({ source: "truth" }, "x"), false);
assert.equal(matchesSignalFeedTab({ source: "truth" }, "truth"), true);
assert.equal(matchesSignalFeedTab({ source: "telegram" }, "telegram"), true);
assert.equal(matchesSignalFeedTab({ source: "monitor985" }, "all"), true);

assert.equal(getXSourceBadgeLabel("x"), "6551 历史");
assert.equal(getXSourceBadgeLabel("monitor985"), "985 采集");
assert.equal(getXSourceBadgeLabel("truth"), null);

console.log("ok - signal feed tabs merge 6551 and 985 while keeping truth separate");

assert.equal(isMergedXSignalSource("owned-reader"), true);
assert.equal(matchesSignalFeedTab({ source: "owned-reader" }, "x"), true);
assert.equal(getXSourceBadgeLabel("owned-reader"), "VPS 采集");

for (const source of ["telegram", "x", "monitor985", "owned-reader", "truth", "alert"]) {
  assert.equal(matchesSignalFeedCollector({ source }, "all"), true);
  assert.equal(matchesSignalFeedCollector({ source }, "monitor985"), source === "monitor985");
  assert.equal(matchesSignalFeedCollector({ source }, "owned-reader"), source === "owned-reader");
}
