import assert from "node:assert/strict";

const {
  getXSourceBadgeLabel,
  isMergedXSignalSource,
  matchesSignalFeedTab,
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

assert.equal(getXSourceBadgeLabel("x"), "6551");
assert.equal(getXSourceBadgeLabel("monitor985"), "985");
assert.equal(getXSourceBadgeLabel("truth"), null);

console.log("ok - signal feed tabs merge 6551 and 985 while keeping truth separate");
