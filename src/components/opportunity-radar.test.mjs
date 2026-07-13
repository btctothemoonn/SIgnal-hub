import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const component = readFileSync(
  new URL("./opportunity-radar.tsx", import.meta.url),
  "utf8",
);

const require = createRequire(import.meta.url);
const ts = require("typescript");
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
  resolveOpportunityClaimEvidence,
  visibleOpportunityItems,
} = productionModule.exports;

assert.equal(typeof applyOpportunitySnapshotMutation, "function");
assert.equal(typeof isOpportunityRequestCurrent, "function");
assert.equal(typeof nextOpportunityRequestSequence, "function");
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

assert.deepEqual(
  Array.from(visibleOpportunityItems(snapshot(
    "active",
    "2026-07-13T01:00:00.000Z",
    { items: [opportunity, { ...opportunity, id: 8, finalScore: 74 }] },
  )), (item) => item.id),
  [7],
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
  const key = "signal-hub:opportunities:v1:all:score:active";
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
  const keyA = "signal-hub:opportunities:v1:all:score:active";
  const keyB = "signal-hub:opportunities:v1:us:score:active";
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
  /signal-hub:opportunities:v1:\$\{market\}:\$\{sort\}:\$\{status\}/,
);
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
assert.match(component, /rounded-lg/);
assert.doesNotMatch(component, /rounded-xl|rounded-2xl|rounded-3xl/);

console.log("ok - opportunity radar cached cards and actions");
