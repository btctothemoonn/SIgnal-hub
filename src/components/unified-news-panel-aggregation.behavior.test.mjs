import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { aggregateSignalFeed } from "../lib/signal-feed-aggregation.ts";
import { matchesSignalFeedCollector, matchesSignalFeedTab } from "../lib/signal-feed-tabs.ts";
import { matchesSignalFeedAuthorFilter } from "../lib/signal-feed-author-filter.ts";
import { getSignalFeedRangeLimit } from "../lib/signal-feed-range.ts";

// Run the real client component with server rendering: its network and scrolling
// effects do not run, while grouping and all rendered source links remain real.
const componentDirectory = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(componentDirectory, "..");
const temporaryDirectory = mkdtempSync(join(componentDirectory, "signal-feed-runtime-"));
const modules = new Map();
function compile(path) {
  if (modules.has(path)) return modules.get(path);
  const outputPath = join(temporaryDirectory, `${modules.size}.mjs`);
  modules.set(path, outputPath);
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: path,
  }).outputText.replace(/from "([^"]+)"/g, (match, specifier) => {
    if (specifier === "next/image") return 'from "next/image.js"';
    if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return match;
    const base = specifier.startsWith("@/") ? join(sourceRoot, specifier.slice(2)) : resolve(dirname(path), specifier);
    const dependency = existsSync(base) ? base : existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`;
    return `from "${pathToFileURL(compile(dependency)).href}"`;
  });
  writeFileSync(outputPath, output);
  return outputPath;
}

try {
  const { UnifiedNewsPanel } = await import(pathToFileURL(compile(join(componentDirectory, "unified-news-panel.tsx"))).href);
  function telegramMessage(overrides = {}) {
    return {
      id: "channel:11", channelRef: "alpha", channelTitle: "Alpha channel", channelUsername: "alpha", channelId: "11",
      channelLink: "https://t.me/alpha", channelAvatar: null, messageUrl: "https://t.me/alpha/11",
      text: "Protocol release https://example.com/articles/protocol", createdAt: "2026-10-02T00:00:00.000Z",
      views: 0, forwards: 0, origin: "history", media: null, translation: null, quotedMessage: null, ...overrides,
    };
  }
  function tweet(overrides = {}) {
    return {
      id: "9001", username: "research", displayName: "Research", profileUrl: "https://x.com/research", userAvatar: "",
      tweetUrl: "https://x.com/research/status/9001", text: "My independent assessment https://example.com/articles/protocol?utm_source=x",
      createdAt: "2026-10-02T01:00:00.000Z", hashtags: [], likes: 0, retweets: 0, replies: 0, quotes: 0, views: 0,
      media: [], quotedTweet: null, origin: "watch", queryLabel: "", translation: null, ...overrides,
    };
  }
  function render(telegram = [], x = [], snapshotOverrides = {}) {
    return renderToStaticMarkup(React.createElement(UnifiedNewsPanel, {
      initialTelegramSnapshot: { provider: "telegram", mode: "mtproto", isConfigured: true, isConnected: false, status: "live", channels: [], feed: telegram, note: "", errors: [] },
      initialXSnapshot: { provider: "6551", baseUrl: "", isConfigured: true, isConnected: false, status: "live", watchAccounts: [], trackedKeywords: [], feed: x, note: "", errors: [], ...snapshotOverrides },
    }));
  }

  test("retired 6551 controls stay hidden while actual 985, VPS and historical sources remain distinguishable", () => {
    const html = render([], [
      tweet({ id: "9011", text: "985 independent source", queryLabel: "985monitor / NEW_TWEET" }),
      tweet({ id: "9012", text: "VPS independent source", contentSource: "owned-reader", queryLabel: "owned-reader / full" }),
      tweet({ id: "9013", text: "Archived independent source", queryLabel: "Telegram trigger / full" }),
    ], { usage: { pointsUsed: 300, limit: 300, blocked: true } });
    assert.match(html, /985 采集/);
    assert.match(html, /VPS 采集/);
    assert.match(html, /6551 历史/);
    assert.match(html, /刷新 985/);
    assert.match(html, /data-signal-collector-filter[^>]*role="group"[^>]*aria-label="X 采集来源"/);
    const collectorMarkup = html.match(/data-signal-collector-filter[\s\S]*?<\/div>/)?.[0];
    assert.ok(collectorMarkup);
    assert.equal((collectorMarkup.match(/aria-pressed="true"/g) || []).length, 1);
    assert.match(collectorMarkup, /aria-pressed="true"[^>]*>全部<\/button>/);
    assert.match(collectorMarkup, />985<\/button>/);
    assert.match(collectorMarkup, />VPS<\/button>/);
    assert.doesNotMatch(html, /6551 补漏|X points|Authorize X today/);
  });

  test("copies of one original render one row with every author's commentary and permalink retained", () => {
    const html = render([telegramMessage()], [tweet()]);
    assert.equal((html.match(/<article /g) || []).length, 1);
    assert.match(html, /<details/);
    assert.match(html, /Protocol release/);
    assert.match(html, /My independent assessment/);
    assert.match(html, /href="https:\/\/t\.me\/alpha\/11"/);
    assert.match(html, /href="https:\/\/x\.com\/research\/status\/9001"/);
  });

  test("Telegram original action opens the message while the author header opens the channel", () => {
    const html = render([telegramMessage({ text: "A single standalone message" })]);
    assert.match(html, /href="https:\/\/t\.me\/alpha\/11"[^>]*aria-label="查看原文"/);
    assert.match(html, /href="https:\/\/t\.me\/alpha"[^>]*>Alpha channel<\/a>/);
  });

  test("legacy Telegram messages without a valid message permalink keep the channel action", () => {
    for (const messageUrl of [undefined, "javascript:alert(1)", "https://t.me/alpha", "https://example.com/story"]) {
      const html = render([telegramMessage({ messageUrl, text: "Legacy message" })]);
      assert.match(html, /href="https:\/\/t\.me\/alpha"[^>]*aria-label="查看频道"/);
    }
  });

  // Exercise the component's real filtering callback against members before
  // grouping, without bringing source streams into a deterministic filter test.
  const path = join(componentDirectory, "unified-news-panel.tsx");
  const ast = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let filteringBody;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "filteredFeed") filteringBody = node.initializer.arguments[0].body.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const helpers = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && ["sortByCreatedAt", "limitNewsItems", "feedLimitForTab"].includes(node.name?.text)).map((node) => node.getText(ast)).join("\n");
  const code = ts.transpileModule(`${helpers}\nreturn function(unifiedFeed, deferredSearchQuery, activeTab = "all", effectiveAuthorFilter = "__all__", feedRange = "latest", collectorFilter = "all") ${filteringBody}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const filter = new Function("matchesSignalFeedTab", "matchesSignalFeedCollector", "matchesSignalFeedAuthorFilter", "getSignalFeedRangeLimit", code)(matchesSignalFeedTab, matchesSignalFeedCollector, matchesSignalFeedAuthorFilter, getSignalFeedRangeLimit);
  const filterItems = [
    { id: "telegram:one", source: "telegram", title: "Alpha", subtitle: "@alpha", text: "Report https://news.example/articles/one", translation: null, quotedTweet: null, link: "https://t.me/alpha/1", createdAt: "2026-10-02T01:00:00Z" },
    { id: "x:two", source: "monitor985", title: "Research", subtitle: "@research", text: "Assessment https://news.example/articles/one", translation: { text: "公开测试发现了新的限制" }, quotedTweet: { text: "Release", translation: { text: "原帖翻译：发布已延期" } }, link: "https://x.com/research/status/123", createdAt: "2026-10-02T02:00:00Z" },
  ];
  test("matching member translations survive filtering before copies are grouped", () => {
    const groups = aggregateSignalFeed(filter(filterItems, "新的限制"));
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].members.map((member) => member.id), ["x:two"]);
    assert.equal(groups[0].text, "Assessment https://news.example/articles/one");
    assert.deepEqual(aggregateSignalFeed(filter(filterItems, "发布已延期"))[0].aliases, ["x:two"]);
  });
  test("source and author filters retain just the matching copies of a group", () => {
    assert.deepEqual(aggregateSignalFeed(filter(filterItems, "", "telegram"))[0].aliases, ["telegram:one"]);
    assert.deepEqual(aggregateSignalFeed(filter(filterItems, "", "x", "x:research"))[0].aliases, ["x:two"]);
    assert.equal(aggregateSignalFeed(filter(filterItems, "新的限制", "telegram")).length, 0);
  });
  test("collector filtering happens before cross-source copies are grouped", () => {
    const rows = [
      ...filterItems,
      { ...filterItems[1], id: "x:vps", source: "owned-reader", text: "VPS commentary https://news.example/articles/one", createdAt: "2026-10-02T03:00:00Z" },
    ];
    const grouped985 = aggregateSignalFeed(filter(rows, "", "all", "__all__", "latest", "monitor985"));
    const groupedVps = aggregateSignalFeed(filter(rows, "", "x", "__all__", "latest", "owned-reader"));
    assert.equal(grouped985.length, 1);
    assert.deepEqual(grouped985[0].aliases, ["x:two"]);
    assert.equal(groupedVps.length, 1);
    assert.deepEqual(groupedVps[0].aliases, ["x:vps"]);
    assert.equal(groupedVps[0].text, "VPS commentary https://news.example/articles/one");
    assert.equal(aggregateSignalFeed(filter(rows, ""))[0].members.length, 3);
  });

} finally {
  // The generated directory is always a direct child of the test directory.
  if (dirname(temporaryDirectory) !== componentDirectory) throw new Error("Unsafe runtime cleanup path");
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
