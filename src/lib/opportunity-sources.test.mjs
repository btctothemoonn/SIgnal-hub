import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadOpportunityPriorityAssetKeys,
  loadOpportunityMarketReaction,
  loadOpportunitySourceItems,
  normalizeCatalystOpportunityItems,
  normalizeDouyinOpportunityItems,
  normalizeTelegramOpportunityItems,
  normalizeXOpportunityItems,
} from "./opportunity-sources.ts";

const now = new Date("2026-07-12T12:00:00.000Z");

const xItems = normalizeXOpportunityItems(
  {
    feed: [
      {
        id: "1",
        text: "$NVDA wins new AI order",
        createdAt: "2026-07-12T01:00:00.000Z",
        username: "a",
        tweetUrl: "https://x.com/a/1",
        translation: null,
      },
    ],
  },
  { now },
);
assert.equal(xItems.length, 1);
assert.equal(xItems[0].id, "x:1");
assert.deepEqual(xItems[0].assetKeys, ["NVDA"]);
assert.equal(xItems[0].eventType, "order");
assert.equal(normalizeTelegramOpportunityItems({ feed: [] }, { now }).length, 0);
assert.equal(normalizeCatalystOpportunityItems({ catalysts: {} }, { now }).length, 0);
assert.equal(normalizeDouyinOpportunityItems({ videos: [] }, { now }).length, 0);

const telegramItems = normalizeTelegramOpportunityItems(
  {
    feed: [
      {
        id: "42",
        text: "A".repeat(2_100) + " $TSM earnings update",
        createdAt: "2026-07-11T12:00:00.000Z",
        channelTitle: "Semis",
        channelUsername: "semis",
        messageUrl: "https://t.me/semis/42",
        translation: { text: "TSM earnings outlook" },
      },
      {
        id: "expired",
        text: "$AMD order",
        createdAt: "2026-07-05T11:59:59.000Z",
        channelTitle: "Old",
        channelUsername: "old",
        messageUrl: "https://t.me/old/1",
        translation: null,
      },
    ],
  },
  { now },
);
assert.equal(telegramItems.length, 1);
assert.equal(telegramItems[0].sourceType, "telegram");
assert.deepEqual(telegramItems[0].assetKeys, ["TSM"]);
assert.equal(telegramItems[0].eventType, "earnings");
assert.ok(telegramItems[0].text.length > telegramItems[0].textExcerpt.length);
assert.equal(telegramItems[0].textExcerpt.length, 2_000);
assert.equal(telegramItems[0].translation, "TSM earnings outlook");

const catalystItems = normalizeCatalystOpportunityItems(
  {
    catalysts: {
      NVDA: [
        {
          title: "Private research",
          summary: "NVDA order momentum is improving",
          fullSummary: "private paid Patreon post body must never be exposed",
          date: "2026-07-10",
          type: "industry-event",
          impact: "positive",
          source: "Patreon",
          sourceRole: "subscription",
          author: "Analyst",
          link: "https://www.patreon.com/posts/123",
        },
      ],
    },
  },
  { now },
);
assert.equal(catalystItems.length, 1);
assert.equal(catalystItems[0].sourceType, "patreon");
assert.deepEqual(catalystItems[0].assetKeys, ["NVDA"]);
assert.equal(catalystItems[0].text, "Private research\nNVDA order momentum is improving");
assert.equal(catalystItems[0].text.includes("private paid Patreon"), false);
assert.equal(catalystItems[0].eventType, "order");

const stableCatalysts = [
  {
    title: "Stable without link",
    summary: "NVDA contract demand",
    date: "2026-07-11T00:00:00.000Z",
    type: "industry-event",
    impact: "positive",
    source: "Google News",
  },
  {
    title: "Stable with link",
    summary: "NVDA revenue update",
    date: "2026-07-11T00:00:00.000Z",
    type: "earnings",
    impact: "positive",
    source: "Yahoo Finance",
    link: "https://example.com/nvda-earnings",
  },
];
const stableIds = new Map(
  normalizeCatalystOpportunityItems({ catalysts: { NVDA: stableCatalysts } }, { now }).map(
    (item) => [item.text, item.id],
  ),
);
const reorderedIds = new Map(
  normalizeCatalystOpportunityItems(
    {
      catalysts: {
        NVDA: [
          {
            title: "Newly inserted catalyst",
            summary: "NVDA policy update",
            date: "2026-07-11T00:00:00.000Z",
            type: "regulatory",
            impact: "neutral",
            source: "Google News",
          },
          ...stableCatalysts.slice().reverse(),
        ],
      },
    },
    { now },
  ).map((item) => [item.text, item.id]),
);
for (const [text, id] of stableIds) {
  assert.equal(reorderedIds.get(text), id, `${text} keeps its stable source ID`);
}
assert.equal(
  stableIds.get("Stable with link\nNVDA revenue update"),
  "news:NVDA:https://example.com/nvda-earnings",
);
const noLinkCatalystOriginal = normalizeCatalystOpportunityItems(
  { catalysts: { NVDA: [stableCatalysts[0]] } },
  { now },
)[0];
const noLinkCatalystEdited = normalizeCatalystOpportunityItems(
  {
    catalysts: {
      NVDA: [{
        ...stableCatalysts[0],
        title: "Editorially revised headline",
        summary: "Editorially revised body text with different wording",
      }],
    },
  },
  { now },
)[0];
assert.equal(
  noLinkCatalystEdited.id,
  noLinkCatalystOriginal.id,
  "no-link catalyst identity ignores editable title and summary text",
);

const sharedLinkItems = normalizeCatalystOpportunityItems(
  {
    catalysts: {
      NVDA: [
        {
          title: "Shared source",
          summary: "NVDA update",
          date: "2026-07-11T00:00:00.000Z",
          type: "earnings",
          impact: "positive",
          source: "Yahoo Finance",
          link: "https://example.com/shared-market-update",
        },
      ],
      AMD: [
        {
          title: "Shared source",
          summary: "AMD update",
          date: "2026-07-11T00:00:00.000Z",
          type: "earnings",
          impact: "positive",
          source: "Yahoo Finance",
          link: "https://example.com/shared-market-update",
        },
      ],
    },
  },
  { now },
);
assert.equal(sharedLinkItems.length, 2);
assert.deepEqual(
  sharedLinkItems.map((item) => item.id).sort(),
  [
    "news:AMD:https://example.com/shared-market-update",
    "news:NVDA:https://example.com/shared-market-update",
  ],
);

const douyinItems = normalizeDouyinOpportunityItems(
  {
    videos: [
      {
        id: "dy-1",
        creatorName: "Market desk",
        title: "A-share AI supply chain",
        description: "video description",
        publishedAt: "2026-07-10T12:00:00.000Z",
        videoUrl: "https://www.douyin.com/video/dy-1",
        summary: {
          status: "generated",
          coreView: "订单继续改善",
          assets: ["中际旭创", "300308"],
          recommendationReasons: ["AI 订单增长"],
          catalysts: ["新订单"],
          risks: [],
          followUps: [],
        },
      },
    ],
  },
  { now },
);
assert.equal(douyinItems.length, 1);
assert.deepEqual(douyinItems[0].assetKeys, ["中际旭创", "300308"]);
assert.equal(douyinItems[0].market, "cn");
assert.equal(douyinItems[0].eventType, "order");

const cacheDir = await mkdtemp(join(tmpdir(), "opportunity-sources-"));
try {
  const marketCachePath = join(cacheDir, "market.json");
  await writeFile(
    marketCachePath,
    JSON.stringify({
      generatedAt: "2026-07-12T12:00:00.000Z",
      source: "live",
      provider: "finnhub",
      errors: [],
      quotes: {
        NVDA: { dayChangePct: -3.4 },
        "300308": { dayChangePct: 8.2 },
      },
    }),
  );
  const env = { STOCKS_MARKET_CACHE_PATH: marketCachePath };
  assert.deepEqual(await loadOpportunityMarketReaction(["UNKNOWN", "NVDA"], { env }), {
    available: true,
    absoluteMovePercent: 3.4,
  });
  assert.deepEqual(await loadOpportunityMarketReaction(["300308"], { env }), {
    available: false,
    absoluteMovePercent: null,
  });
} finally {
  await rm(cacheDir, { recursive: true, force: true });
}

const calls = {
  telegram: 0,
  x: 0,
  catalysts: 0,
  douyin: 0,
  persistedTiger: 0,
  persistedBinance: 0,
};
const readers = {
  telegram: () => {
    calls.telegram += 1;
    return { feed: [] };
  },
  x: () => {
    calls.x += 1;
    return { feed: [] };
  },
  catalysts: async () => {
    calls.catalysts += 1;
    return null;
  },
  douyin: async () => {
    calls.douyin += 1;
    return { videos: [] };
  },
  readPersistedTigerHoldingData: async () => {
    calls.persistedTiger += 1;
    return null;
  },
  readPersistedBinanceHoldingSnapshot: async () => {
    calls.persistedBinance += 1;
    return null;
  },
  market: async () => null,
};
assert.deepEqual(await loadOpportunitySourceItems({ readers }), []);
assert.deepEqual(calls, {
  telegram: 1,
  x: 1,
  catalysts: 1,
  douyin: 1,
  persistedTiger: 0,
  persistedBinance: 0,
});
const priorityKeys = await loadOpportunityPriorityAssetKeys({ readers });
assert.equal(priorityKeys.has("NVDA"), true);
assert.deepEqual(calls, {
  telegram: 1,
  x: 1,
  catalysts: 1,
  douyin: 1,
  persistedTiger: 1,
  persistedBinance: 1,
});

console.log("ok - opportunity sources");
