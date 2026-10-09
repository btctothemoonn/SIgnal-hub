import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { matchesSignalFeedCollector, matchesSignalFeedTab } from "../lib/signal-feed-tabs.ts";
import { matchesSignalFeedAuthorFilter } from "../lib/signal-feed-author-filter.ts";
import { getSignalFeedRangeLimit } from "../lib/signal-feed-range.ts";

// Exercise the real filtering callback without mounting the feed's network,
// scrolling, and media effects. AST selection avoids textual layout matching.
const path = new URL("./unified-news-panel.tsx", import.meta.url);
const source = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let filteringBody;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "filteredFeed") {
    filteringBody = node.initializer.arguments[0].body.getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(filteringBody, "the feed filtering callback must be available for behavior checks");
const helpers = source.statements.filter((node) => ts.isFunctionDeclaration(node) && ["sortByCreatedAt", "limitNewsItems", "feedLimitForTab"].includes(node.name?.text)).map((node) => node.getText(source)).join("\n");
const code = ts.transpileModule(`
  ${helpers}
  return function filterFeed(unifiedFeed, deferredSearchQuery, activeTab = "all", effectiveAuthorFilter = "__all__", feedRange = "latest", collectorFilter = "all") ${filteringBody}
`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const filterFeed = new Function("matchesSignalFeedTab", "matchesSignalFeedCollector", "matchesSignalFeedAuthorFilter", "getSignalFeedRangeLimit", code)(matchesSignalFeedTab, matchesSignalFeedCollector, matchesSignalFeedAuthorFilter, getSignalFeedRangeLimit);

function item(overrides = {}) {
  return { id: "x-1", source: "x", title: "Research", subtitle: "@research", text: "Protocol testing begins tomorrow", translation: { text: "协议测试明天开始" }, quotedTweet: null, createdAt: "2026-10-01T12:00:00Z", ...overrides };
}

test("Chinese search finds the translation of an English original", () => {
  assert.deepEqual(filterFeed([item()], "  协议测试  ").map((row) => row.id), ["x-1"]);
});

test("Chinese search finds a translated quoted post", () => {
  const quoted = item({ text: "Read this", translation: null, quotedTweet: { text: "Launch has been delayed", translation: { text: "上线已延期" } } });
  assert.deepEqual(filterFeed([quoted], "延期").map((row) => row.id), ["x-1"]);
});

test("Search remains trimmed and case insensitive for authors, originals, and quoted originals", () => {
  assert.equal(filterFeed([item()], "  RESEARCH  ").length, 1);
  assert.equal(filterFeed([item()], "  TESTING  ").length, 1);
  assert.equal(filterFeed([item({ quotedTweet: { text: "VOTING opens", translation: null } })], " voting ").length, 1);
  assert.equal(filterFeed([item({ translation: null })], "unrelated").length, 0);
});

test("Translated matches still honor the source and author filters", () => {
  const rows = [item(), item({ id: "tg-1", source: "telegram", title: "研究频道", subtitle: null }), item({ id: "x-2", title: "Other", subtitle: "@other" })];
  assert.deepEqual(filterFeed(rows, "协议", "telegram").map((row) => row.id), ["tg-1"]);
  assert.deepEqual(filterFeed(rows, "协议", "x", "x:research").map((row) => row.id), ["x-1"]);
});

test("Translated search applies the existing range limit after matching", () => {
  const rows = Array.from({ length: 205 }, (_, index) => item({ id: `x-${index}` }));
  assert.equal(filterFeed(rows, "协议", "x", "__all__", "latest").length, 200);
  assert.equal(filterFeed(rows, "协议", "x", "__all__", "12h").length, 205);
});

test("Collector selection isolates 985 and VPS while all preserves other sources", () => {
  const rows = [
    item({ id: "985-1", source: "monitor985" }),
    item({ id: "vps-1", source: "owned-reader" }),
    item({ id: "tg-1", source: "telegram" }),
    item({ id: "truth-1", source: "truth" }),
    item({ id: "legacy-1" }),
  ];
  const idsFor = (collector) => filterFeed(rows, "", "all", "__all__", "latest", collector).map((row) => row.id);
  assert.deepEqual(idsFor("monitor985"), ["985-1"]);
  assert.deepEqual(idsFor("owned-reader"), ["vps-1"]);
  assert.deepEqual(idsFor("all"), rows.map((row) => row.id));
});

test("Collector selection combines with translated search and author filtering", () => {
  const rows = [
    item({ id: "985-1", source: "monitor985" }),
    item({ id: "vps-1", source: "owned-reader" }),
    item({ id: "vps-2", source: "owned-reader", title: "Other", subtitle: "@other" }),
    item({ id: "vps-3", source: "owned-reader", translation: null }),
  ];
  assert.deepEqual(
    filterFeed(rows, "协议", "x", "owned-reader:research", "latest", "owned-reader").map((row) => row.id),
    ["vps-1"],
  );
});

test("Collector selection runs before the display limit so quieter VPS messages remain available", () => {
  const rows = [
    ...Array.from({ length: 205 }, (_, index) => item({ id: `985-${index}`, source: "monitor985" })),
    item({ id: "vps-older", source: "owned-reader", createdAt: "2026-10-01T11:00:00Z" }),
  ];
  assert.deepEqual(
    filterFeed(rows, "", "x", "__all__", "latest", "owned-reader").map((row) => row.id),
    ["vps-older"],
  );
});
