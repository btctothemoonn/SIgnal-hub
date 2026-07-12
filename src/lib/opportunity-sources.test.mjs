import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadOpportunityMarketReaction,
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
  assert.deepEqual(await loadOpportunityMarketReaction("NVDA", { env }), {
    available: true,
    absoluteMovePercent: 3.4,
  });
  assert.deepEqual(await loadOpportunityMarketReaction("300308", { env }), {
    available: false,
    absoluteMovePercent: 0,
  });
} finally {
  await rm(cacheDir, { recursive: true, force: true });
}

console.log("ok - opportunity sources");
