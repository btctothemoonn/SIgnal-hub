import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const component = readFileSync(
  new URL("./opportunity-radar.tsx", import.meta.url),
  "utf8",
);

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const TestRenderer = require("react-test-renderer");
const ts = require("typescript");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const transpiled = ts.transpileModule(component, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const productionModule = { exports: {} };
const productionRequire = (id) => {
  if (id === "@/components/use-browser-json-cache") {
    return { useBrowserJsonCache: () => [null, () => undefined] };
  }
  return require(id);
};
vm.runInNewContext(
  `(function (require, module, exports) { ${transpiled}\n})`,
  { console },
)(productionRequire, productionModule, productionModule.exports);

const {
  applyOpportunitySnapshotMutation,
  isOpportunityRequestCurrent,
  nextOpportunityRequestSequence,
  OpportunityResults,
  partitionOpportunityItems,
  resolveOpportunityClaimEvidence,
  visibleOpportunityItems,
} = productionModule.exports;

assert.equal(typeof applyOpportunitySnapshotMutation, "function");
assert.equal(typeof isOpportunityRequestCurrent, "function");
assert.equal(typeof nextOpportunityRequestSequence, "function");
assert.equal(typeof OpportunityResults, "function");
assert.equal(typeof partitionOpportunityItems, "function");
assert.equal(typeof resolveOpportunityClaimEvidence, "function");
assert.equal(typeof visibleOpportunityItems, "function");

const opportunity = {
  id: 7,
  market: "us",
  assetKeys: ["NVDA"],
  eventType: "product",
  status: "tracking",
  finalScore: 82,
  confidence: "high",
  thesis: "Demand remains strong.",
  reasons: ["Orders accelerated."],
  risks: ["Valuation."],
  invalidation: ["Orders slow."],
  firstSeenAt: "2026-07-13T00:00:00.000Z",
  lastSeenAt: "2026-07-13T01:00:00.000Z",
  validUntil: null,
  tier: "confirmed",
  selectedAt: "2026-07-13T01:00:00.000Z",
  followed: false,
  dismissed: false,
  aiPending: false,
  marketReaction: { available: true, absoluteMovePercent: 1.2 },
  claimEvidence: {
    thesis: ["news:1"],
    reasons: [["news:1", "x:2"]],
    risks: [["x:2"]],
    invalidation: [["news:1"]],
  },
  scoreAudit: { context: {}, components: {}, penalties: [] },
  evidence: [
    {
      id: "news:1",
      sourceType: "news",
      sourceName: "wire",
      publishedAt: "2026-07-13T00:00:00.000Z",
      textExcerpt: "public evidence",
      originalUrl: "https://example.com/news/1",
    },
    {
      id: "x:2",
      sourceType: "x",
      sourceName: "analyst",
      publishedAt: "2026-07-13T00:05:00.000Z",
      textExcerpt: "second source",
      originalUrl: "https://example.com/x/2",
    },
  ],
};

assert.equal(
  resolveOpportunityClaimEvidence(opportunity.evidence, ["x:2", "news:1", "missing"])
    .map((item) => item.id)
    .join(","),
  "x:2,news:1",
);
const snapshot = (status, generatedAt, overrides = {}) => ({
  generatedAt,
  lastWorkerSuccessAt: generatedAt,
  market: "all",
  sort: "score",
  status,
  items: [{ ...opportunity }],
  error: null,
  ...overrides,
});

const renderResults = (items) => renderToStaticMarkup(
  React.createElement(OpportunityResults, {
    snapshot: snapshot("active", "2026-07-13T01:00:00.000Z", { items }),
    onFollow: async () => undefined,
    onDismiss: async () => undefined,
  }),
);
const renderedSection = (markup, headingId) => {
  const match = markup.match(
    new RegExp(`<section[^>]*aria-labelledby="${headingId}"[^>]*>([\\s\\S]*?)</section>`),
  );
  assert.ok(match, `missing rendered section ${headingId}`);
  return match[1];
};

{
  const markup = renderResults([
    { ...opportunity, assetKeys: ["CONFIRMED-ASSET"] },
    {
      ...opportunity,
      id: 8,
      assetKeys: ["WATCH-ASSET"],
      tier: "watch",
      finalScore: 70,
      selectedAt: null,
    },
  ]);
  const confirmedMarkup = renderedSection(markup, "confirmed-opportunities-heading");
  const watchMarkup = renderedSection(markup, "watch-opportunities-heading");
  assert.match(confirmedMarkup, /CONFIRMED-ASSET/);
  assert.doesNotMatch(confirmedMarkup, /WATCH-ASSET/);
  assert.match(watchMarkup, /WATCH-ASSET/);
  assert.doesNotMatch(watchMarkup, /CONFIRMED-ASSET/);
  assert.match(confirmedMarkup, /aria-label="关注"/);
  assert.match(confirmedMarkup, /aria-label="忽略"/);
  assert.match(confirmedMarkup, /aria-label="展开"[^>]*aria-expanded="false"/);
}

{
  const markup = renderResults([{
    ...opportunity,
    id: 8,
    assetKeys: ["WATCH-ONLY"],
    tier: "watch",
    finalScore: 70,
    selectedAt: null,
  }]);
  assert.match(
    renderedSection(markup, "confirmed-opportunities-heading"),
    /暂无确认机会/,
  );
  assert.doesNotMatch(
    renderedSection(markup, "watch-opportunities-heading"),
    /暂无候选观察/,
  );
}

{
  const markup = renderResults([{ ...opportunity, assetKeys: ["CONFIRMED-ONLY"] }]);
  assert.doesNotMatch(
    renderedSection(markup, "confirmed-opportunities-heading"),
    /暂无确认机会/,
  );
  assert.match(
    renderedSection(markup, "watch-opportunities-heading"),
    /暂无候选观察/,
  );
}

{
  const item = { ...opportunity, assetKeys: ["INTERACTIVE-ASSET"] };
  const followCalls = [];
  const dismissCalls = [];
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(OpportunityResults, {
        snapshot: snapshot("active", "2026-07-13T01:00:00.000Z", { items: [item] }),
        onFollow: async (candidate, followed) => {
          followCalls.push({ candidate, followed });
        },
        onDismiss: async (candidate) => {
          dismissCalls.push(candidate);
        },
      }),
    );
  });

  assert.deepEqual(
    renderer.root.findByProps({ id: "confirmed-opportunities-heading" }).children,
    ["确认机会"],
  );
  assert.deepEqual(
    renderer.root.findByProps({ id: "watch-opportunities-heading" }).children,
    ["候选观察"],
  );

  let article = renderer.root.findByType("article");
  await TestRenderer.act(async () => {
    article.findByProps({ "aria-label": "关注" }).props.onClick();
  });
  assert.equal(followCalls.length, 1);
  assert.equal(followCalls[0].candidate, item);
  assert.equal(followCalls[0].followed, true);

  article = renderer.root.findByType("article");
  await TestRenderer.act(async () => {
    article.findByProps({ "aria-label": "忽略" }).props.onClick();
  });
  assert.deepEqual(dismissCalls, [item]);

  article = renderer.root.findByType("article");
  await TestRenderer.act(async () => {
    article.findByProps({ "aria-label": "展开" }).props.onClick();
  });
  article = renderer.root.findByType("article");
  assert.equal(
    article.findByProps({ "aria-label": "收起" }).props["aria-expanded"],
    true,
  );
  assert.equal(
    article.findAllByType("li").some((node) => node.children.includes("Orders accelerated.")),
    true,
  );

  await TestRenderer.act(async () => {
    article.findByProps({ "aria-label": "收起" }).props.onClick();
  });
  article = renderer.root.findByType("article");
  assert.equal(
    article.findByProps({ "aria-label": "展开" }).props["aria-expanded"],
    false,
  );
  assert.equal(article.findAllByType("li").length, 0);

  await TestRenderer.act(async () => {
    renderer.unmount();
  });
}

assert.deepEqual(
  Array.from(visibleOpportunityItems(snapshot(
    "active",
    "2026-07-13T01:00:00.000Z",
    {
      items: [
        opportunity,
        { ...opportunity, id: 8, tier: "watch", finalScore: 74, selectedAt: null },
        { ...opportunity, id: 9, tier: "confirmed", finalScore: 74 },
        { ...opportunity, id: 10, tier: "watch", finalScore: 75 },
        { ...opportunity, id: 11, tier: "watch", finalScore: 59 },
        { ...opportunity, id: 12, tier: "unknown", finalScore: 90 },
        { ...opportunity, id: 13, tier: "confirmed", finalScore: Number.NaN },
      ],
    },
  )), (item) => item.id),
  [7, 8],
);
assert.deepEqual(
  Array.from(
    partitionOpportunityItems([
      opportunity,
      { ...opportunity, id: 8, tier: "watch", finalScore: 67, selectedAt: null },
    ]).confirmed,
    (item) => item.id,
  ),
  [7],
);
assert.deepEqual(
  Array.from(
    partitionOpportunityItems([
      opportunity,
      { ...opportunity, id: 8, tier: "watch", finalScore: 67, selectedAt: null },
    ]).watch,
    (item) => item.id,
  ),
  [8],
);
assert.deepEqual(
  Array.from(visibleOpportunityItems(snapshot(
    "history",
    "2026-07-13T01:00:00.000Z",
    { items: [opportunity, { ...opportunity, id: 8, finalScore: 74 }] },
  )), (item) => item.id),
  [7, 8],
);

{
  const sequences = new Map();
  const key = "signal-hub:opportunities:v2:all:score:active";
  const staleGet = nextOpportunityRequestSequence(sequences, key);
  let current = snapshot("active", "2026-07-13T01:00:00.000Z");

  nextOpportunityRequestSequence(sequences, key);
  current = applyOpportunitySnapshotMutation(current, {
    type: "follow",
    id: opportunity.id,
    followed: true,
  });

  if (isOpportunityRequestCurrent(sequences, key, staleGet)) {
    current = snapshot("active", "2026-07-13T00:30:00.000Z");
  }

  assert.equal(current.items[0].followed, true);
}

{
  const sequences = new Map();
  const keyA = "signal-hub:opportunities:v2:all:score:active";
  const keyB = "signal-hub:opportunities:v2:us:score:active";
  const firstA = nextOpportunityRequestSequence(sequences, keyA);
  const onlyB = nextOpportunityRequestSequence(sequences, keyB);
  const secondA = nextOpportunityRequestSequence(sequences, keyA);
  const accepted = new Map();
  const accept = (key, sequence, value) => {
    if (isOpportunityRequestCurrent(sequences, key, sequence)) {
      accepted.set(key, value);
    }
  };

  accept(keyA, secondA, "second A");
  accept(keyB, onlyB, "only B");
  accept(keyA, firstA, "stale first A");

  assert.equal(accepted.get(keyA), "second A");
  assert.equal(accepted.get(keyB), "only B");
}

{
  const active = applyOpportunitySnapshotMutation(
    snapshot("active", "2026-07-13T01:00:00.000Z"),
    { type: "dismiss", id: opportunity.id },
  );
  const history = applyOpportunitySnapshotMutation(
    snapshot("history", "2026-07-13T01:00:00.000Z"),
    { type: "dismiss", id: opportunity.id },
  );

  assert.equal(active.items.length, 0);
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].dismissed, true);
}

assert.match(component, /useBrowserJsonCache<OpportunitySnapshot>\(cacheKey\)/);
assert.match(
  component,
  /signal-hub:opportunities:v2:\$\{market\}:\$\{sort\}:\$\{status\}/,
);
assert.match(component, /确认机会/);
assert.match(component, /候选观察/);
assert.match(component, /确认/);
assert.match(component, /观察/);
assert.match(component, /暂无确认机会/);
assert.match(component, /暂无候选观察/);
assert.match(component, /requestSequencesRef/);
assert.match(component, /snapshotsRef/);
assert.match(component, /\/api\/opportunities\?\$\{query\.toString\(\)\}/);
assert.match(component, /5 \* 60 \* 1000/);
assert.match(component, /method: "POST"/);
assert.match(component, /follow/);
assert.match(component, /dismiss/);
assert.match(component, /applyOpportunitySnapshotMutation/);
assert.doesNotMatch(component, /router\.refresh|location\.reload/);
assert.doesNotMatch(component, /signal-summary|alpha-summary/);
assert.doesNotMatch(component, /\/api\/opportunities\/refresh/);

for (const label of [
  "评分",
  "信心",
  "市场",
  "资产",
  "事件",
  "状态",
  "时间窗",
  "来源",
  "价格反应",
  "理由",
  "风险",
  "失效条件",
  "打开原文",
  "关注",
  "忽略",
  "展开",
]) {
  assert.match(component, new RegExp(label));
}

assert.match(component, /item\.firstSeenAt/);
assert.match(component, /item\.lastSeenAt/);
assert.match(component, /已保留上次缓存/);
assert.match(
  component,
  /aria-label=\{`资产 \$\{item\.assetKeys\.join\(" · "\)\}`\}/,
);
assert.doesNotMatch(component, /className="sr-only"/);

assert.match(component, /aria-label=\{followLabel\}/);
assert.match(component, /title=\{followLabel\}/);
assert.match(component, /item\.dismissed \? "已忽略" : "忽略"/);
assert.match(component, /disabled=\{pendingAction !== null \|\| item\.dismissed\}/);
assert.match(component, /aria-label=\{expanded \? "收起" : "展开"\}/);
assert.match(component, /target="_blank"/);
assert.match(component, /rel="noreferrer"/);
assert.match(component, /OpportunityClaimEvidenceLinks/);
assert.match(component, /claimEvidence\.thesis/);
assert.match(component, /evidenceIdsByItem/);
assert.match(component, /item\.claimEvidence \?\?/);
assert.match(component, /visibleOpportunityItems\(snapshot\)/);
assert.match(component, /text-success/);
assert.doesNotMatch(component, /text-positive/);
assert.match(component, /rounded-lg/);
assert.doesNotMatch(component, /rounded-xl|rounded-2xl|rounded-3xl/);

console.log("ok - opportunity radar cached cards and actions");
