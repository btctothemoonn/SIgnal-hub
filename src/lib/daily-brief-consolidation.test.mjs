import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  buildDailyBriefPrompt,
  getDailyInvestmentBriefByDate,
  getDailyInvestmentBriefHistory,
  getDailyBriefPeriod,
  getOrCreateDailyInvestmentBrief,
  parseDailyBriefContent,
} = await import("./daily-investment-brief.ts");
const { groupDailyBriefItems } = await import("./daily-brief-display.ts");

function rawItem(topic, index) {
  return {
    rank: index + 1,
    importance: "medium",
    title: `${topic} item ${index + 1}`,
    topic,
    candidateIndexes: [1],
    sourceNames: ["Reuters"],
    sourceUrls: [],
    imageUrl: null,
    whatHappened: "发生了重要变化",
    investmentImpact: "影响相关资产定价",
    watchNext: "继续跟踪后续数据",
  };
}

const oversized = parseDailyBriefContent(
  JSON.stringify({
    title: "每日投资简报",
    marketPulse: "测试分类上限",
    items: [
      ...Array.from({ length: 12 }, (_, index) =>
        rawItem("AI / 科技产业链", index),
      ),
      ...Array.from({ length: 12 }, (_, index) =>
        rawItem("BTC / 加密货币", index),
      ),
      ...Array.from({ length: 12 }, (_, index) =>
        rawItem("宏观 / 地缘政治 / 原油", index),
      ),
    ],
    watchVariables: [],
    priorityLine: "AI > 币圈 > 宏观",
  }),
);
const oversizedGroups = groupDailyBriefItems(oversized.items);
assert.equal(oversized.items.length, 30);
assert.equal(oversizedGroups.ai.length, 10);
assert.equal(oversizedGroups.crypto.length, 10);
assert.equal(oversizedGroups.markets.length, 10);

const firstCandidate = {
  id: "https://www.reuters.com/technology/ai-first",
  source: "Reuters",
  title: "AI first edition catalyst",
  summary: "AI infrastructure demand improved.",
  url: "https://www.reuters.com/technology/ai-first",
  publishedAt: "2026-08-24T16:05:00.000Z",
  imageUrl: null,
  language: "English",
  country: "US",
};
const secondCandidate = {
  id: "https://theblockbeats.info/news/crypto-update",
  source: "BlockBeats",
  title: "Crypto morning update",
  summary: "Bitcoin liquidity improved.",
  url: "https://theblockbeats.info/news/crypto-update",
  publishedAt: "2026-08-25T00:05:00.000Z",
  imageUrl: null,
  language: "Chinese",
  country: "CN",
};

function briefFor(candidate, topic, title, period) {
  return {
    title: `每日投资简报｜${period.label}`,
    marketPulse: `${title} 市场总览`,
    items: [
      {
        rank: 1,
        importance: "high",
        title,
        topic,
        candidateIndexes: [1],
        sourceNames: [candidate.source],
        sourceUrls: [],
        imageUrl: null,
        whatHappened: candidate.summary,
        investmentImpact: "影响风险资产定价",
        watchNext: "跟踪下一项催化",
      },
    ],
    watchVariables: [title],
    priorityLine: title,
  };
}

const dir = await mkdtemp(join(tmpdir(), "daily-brief-consolidation-"));
const dbPath = join(dir, "brief.sqlite");
const env = {
  DAILY_BRIEF_DB: dbPath,
  MINIMAX_API_KEY: "test-key",
  AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
  AI_SUMMARY_MODEL: "MiniMax-M2.7",
};
const midnight = new Date("2026-08-24T16:05:00.000Z");
const morning = new Date("2026-08-25T00:05:00.000Z");

await getOrCreateDailyInvestmentBrief({
  force: true,
  now: midnight,
  env,
  collectCandidates: async () => [firstCandidate],
  requestBrief: async ({ provider, period }) => ({
    brief: briefFor(
      firstCandidate,
      "AI / 科技产业链",
      "午夜 AI 催化",
      period,
    ),
    provider,
  }),
});

const secondPrompt = buildDailyBriefPrompt({
  period: getDailyBriefPeriod({ now: morning }),
  candidates: [secondCandidate],
  existingBrief: briefFor(
    firstCandidate,
    "AI / 科技产业链",
    "午夜 AI 催化",
    getDailyBriefPeriod({ now: midnight }),
  ),
  maxItemsPerGroup: 10,
});
assert.match(secondPrompt, /当天现有简报/);
assert.match(secondPrompt, /每个分类最多 10 条/);
const existingBriefPrompt = secondPrompt.slice(
  secondPrompt.indexOf("当天现有简报（"),
  secondPrompt.indexOf("候选新闻:", secondPrompt.indexOf("当天现有简报（")),
);
assert.doesNotMatch(
  existingBriefPrompt,
  /"candidateIndexes"/,
  "indexes from an earlier edition must not be reused against new candidates",
);

await getOrCreateDailyInvestmentBrief({
  force: true,
  now: morning,
  env,
  collectCandidates: async () => [secondCandidate],
  requestBrief: async ({ provider, period }) => ({
    brief: briefFor(
      secondCandidate,
      "BTC / 加密货币",
      "早间 BTC 催化",
      period,
    ),
    provider,
  }),
});

const consolidated = await getDailyInvestmentBriefByDate({
  dateKey: "2026-08-25",
  env,
});
assert.deepEqual(
  consolidated?.brief?.items.map((item) => item.title),
  ["早间 BTC 催化", "午夜 AI 催化"],
);
assert.deepEqual(
  consolidated?.brief?.watchVariables,
  ["早间 BTC 催化", "午夜 AI 催化"],
);

const unrelatedCandidate = {
  id: "https://apnews.com/article/unrelated-market-update",
  source: "AP News",
  title: "Unrelated market update",
  summary: "A separate market event occurred.",
  url: "https://apnews.com/article/unrelated-market-update",
  publishedAt: "2026-08-25T08:05:00.000Z",
  imageUrl: null,
  language: "English",
  country: "US",
};
await getOrCreateDailyInvestmentBrief({
  force: true,
  now: new Date("2026-08-25T08:05:00.000Z"),
  env,
  collectCandidates: async () => [unrelatedCandidate],
  requestBrief: async ({ provider, period }) => ({
    brief: briefFor(
      unrelatedCandidate,
      "AI / 科技产业链",
      "午夜 AI 催化",
      period,
    ),
    provider,
  }),
});
const sourceSafe = await getDailyInvestmentBriefByDate({
  dateKey: "2026-08-25",
  env,
});
assert.deepEqual(
  sourceSafe?.brief?.items.find((item) => item.title === "午夜 AI 催化")
    ?.sourceUrls,
  [firstCandidate.url],
  "an earlier item must keep its original source when candidate indexes change",
);

const failedLaterEdition = await getOrCreateDailyInvestmentBrief({
  force: true,
  now: new Date("2026-08-25T09:05:00.000Z"),
  env,
  collectCandidates: async () => [unrelatedCandidate],
  requestBrief: async () => {
    throw new Error("afternoon provider timeout");
  },
});
assert.equal(failedLaterEdition.status, "error");
const retainedAfterFailure = await getDailyInvestmentBriefByDate({
  dateKey: "2026-08-25",
  env,
});
assert.equal(retainedAfterFailure?.brief?.items.length, 2);
assert.match(retainedAfterFailure?.error ?? "", /afternoon provider timeout/);

const attributionDir = await mkdtemp(
  join(tmpdir(), "daily-brief-attribution-"),
);
const attributionEnv = {
  ...env,
  DAILY_BRIEF_DB: join(attributionDir, "brief.sqlite"),
};
const sourceB = {
  ...firstCandidate,
  id: "https://www.reuters.com/markets/source-b",
  url: "https://www.reuters.com/markets/source-b",
  title: "Source B",
};
await getOrCreateDailyInvestmentBrief({
  force: true,
  now: midnight,
  env: attributionEnv,
  collectCandidates: async () => [sourceB, firstCandidate],
  requestBrief: async ({ provider, period }) => ({
    brief: {
      title: `每日投资简报｜${period.label}`,
      marketPulse: "两条已有新闻",
      items: [
        {
          ...rawItem("宏观 / 地缘政治 / 原油", 0),
          title: "旧条目 B",
          candidateIndexes: [1],
        },
        {
          ...rawItem("AI / 科技产业链", 1),
          title: "旧条目 A",
          candidateIndexes: [2],
        },
      ],
      watchVariables: [],
      priorityLine: "A / B",
    },
    provider,
  }),
});
await getOrCreateDailyInvestmentBrief({
  force: true,
  now: morning,
  env: attributionEnv,
  collectCandidates: async () => [sourceB],
  requestBrief: async ({ provider, period }) => ({
    brief: {
      ...briefFor(sourceB, "AI / 科技产业链", "旧条目 A", period),
      items: [
        {
          ...rawItem("AI / 科技产业链", 0),
          title: "旧条目 A",
          candidateIndexes: [1],
        },
      ],
    },
    provider,
  }),
});
const attributionSafe = await getDailyInvestmentBriefByDate({
  dateKey: "2026-08-25",
  env: attributionEnv,
});
assert.deepEqual(
  attributionSafe?.brief?.items.map((item) => item.title),
  ["旧条目 B", "旧条目 A"],
);
assert.deepEqual(
  attributionSafe?.brief?.items.map((item) => item.sourceUrls),
  [[sourceB.url], [firstCandidate.url]],
  "a stale index must not overwrite another earlier item that owns the source",
);

const history = await getDailyInvestmentBriefHistory({
  now: morning,
  days: 15,
  env,
});
assert.equal(history.length, 1);
assert.equal(history[0].itemCount, 2);

const capDir = await mkdtemp(join(tmpdir(), "daily-brief-retention-cap-"));
const capEnv = { ...env, DAILY_BRIEF_DB: join(capDir, "brief.sqlite") };
await getOrCreateDailyInvestmentBrief({
  force: true,
  now: midnight,
  env: capEnv,
  collectCandidates: async () => [firstCandidate],
  requestBrief: async ({ provider, period }) => ({
    brief: briefFor(
      firstCandidate,
      "AI / 科技产业链",
      "必须保留的午夜 AI",
      period,
    ),
    provider,
  }),
});
const tenNewCandidates = Array.from({ length: 10 }, (_, index) => ({
  ...firstCandidate,
  id: `https://www.reuters.com/technology/new-ai-${index + 1}`,
  url: `https://www.reuters.com/technology/new-ai-${index + 1}`,
  title: `New AI ${index + 1}`,
}));
await getOrCreateDailyInvestmentBrief({
  force: true,
  now: morning,
  env: capEnv,
  collectCandidates: async () => tenNewCandidates,
  requestBrief: async ({ provider, period }) => ({
    brief: {
      title: `每日投资简报｜${period.label}`,
      marketPulse: "十条新的 AI 信息",
      items: tenNewCandidates.map((candidate, index) => ({
        ...rawItem("AI / 科技产业链", index),
        title: `新的 AI 信息 ${index + 1}`,
        candidateIndexes: [index + 1],
        sourceNames: [candidate.source],
      })),
      watchVariables: [],
      priorityLine: "AI",
    },
    provider,
  }),
});
const capped = await getDailyInvestmentBriefByDate({
  dateKey: "2026-08-25",
  env: capEnv,
});
assert.equal(capped?.brief?.items.length, 10);
assert.equal(
  capped?.brief?.items.some((item) => item.title === "必须保留的午夜 AI"),
  true,
  "the per-group cap must reserve space for earlier same-day items",
);

console.log("ok - daily brief consolidates same-day editions by group");
