import assert from "node:assert/strict";
import {
  buildAlphaSummaryPrompt,
  getAlphaSummaryDbPath,
  getAlphaSummaryBaseUrl,
  getAlphaSummaryModel,
  getAlphaSummaryPeriod,
  isDeepSeekBaseUrl,
  isMiniMaxBaseUrl,
  isStockSummaryRelevantItem,
  normalizeAlphaSummaryAudience,
  shouldReuseCachedAlphaSummary,
} from "./alpha-summary.ts";

const now = new Date("2026-05-07T04:00:00.000Z");

assert.equal(normalizeAlphaSummaryAudience("stocks"), "stocks");
assert.equal(normalizeAlphaSummaryAudience("bad"), "signals");
assert.equal(isMiniMaxBaseUrl("https://api.minimax.io/v1"), true);
assert.equal(isMiniMaxBaseUrl("https://api.minimaxi.com/v1"), true);
assert.equal(isMiniMaxBaseUrl("https://api.openai.com/v1"), false);
assert.equal(isDeepSeekBaseUrl("https://api.deepseek.com"), true);
assert.equal(isDeepSeekBaseUrl("https://api.deepseek.com/v1"), true);
assert.equal(isDeepSeekBaseUrl("https://api.openai.com/v1"), false);
assert.equal(
  getAlphaSummaryBaseUrl({ DEEPSEEK_API_KEY: "test-deepseek-key" }),
  "https://api.deepseek.com",
);
assert.equal(
  getAlphaSummaryModel({ DEEPSEEK_API_KEY: "test-deepseek-key" }),
  "deepseek-v4-flash",
);
assert.equal(
  getAlphaSummaryBaseUrl({
    DEEPSEEK_API_KEY: "test-deepseek-key",
    AI_SUMMARY_BASE_URL: "http://127.0.0.1:1435/v1",
  }),
  "https://api.deepseek.com",
);
assert.equal(
  getAlphaSummaryModel({
    DEEPSEEK_API_KEY: "test-deepseek-key",
    AI_SUMMARY_MODEL: "chatgpt/gpt-5.2-instant",
  }),
  "deepseek-v4-flash",
);
assert.match(getAlphaSummaryDbPath({}, "signals"), /signal-summary\.sqlite$/);
assert.match(getAlphaSummaryDbPath({}, "stocks"), /stocks-summary\.sqlite$/);
assert.notEqual(
  getAlphaSummaryDbPath({}, "signals"),
  getAlphaSummaryDbPath({}, "stocks"),
);

const reusableCachePeriod = getAlphaSummaryPeriod({ now });
assert.equal(
  shouldReuseCachedAlphaSummary({
    snapshot: {
      success: false,
      status: "error",
      configured: true,
      period: reusableCachePeriod,
      generatedAt: now.toISOString(),
      model: "chatgpt/gpt-5.2-instant",
      itemCount: 12,
      sourceCounts: { telegram: 6, x: 6 },
      summary: null,
      error: "AI summary returned empty content",
    },
    now,
    env: {},
    scope: "12h",
  }),
  false,
);
assert.equal(
  shouldReuseCachedAlphaSummary({
    snapshot: {
      success: false,
      status: "error",
      configured: true,
      period: reusableCachePeriod,
      generatedAt: now.toISOString(),
      model: "chatgpt/gpt-5.2-instant",
      itemCount: 12,
      sourceCounts: { telegram: 6, x: 6 },
      summary: {
        headline: "cached headline",
        authors: [],
        consensus: [],
        risks: [],
        watchlist: [],
      },
      error: "temporary provider error",
    },
    now,
    env: {},
    scope: "12h",
  }),
  true,
);

const stocksPeriod = getAlphaSummaryPeriod({
  now,
  audience: "stocks",
});
assert.equal(stocksPeriod.audience, "stocks");
assert.ok(stocksPeriod.key.startsWith("stocks:"), stocksPeriod.key);

assert.equal(
  isStockSummaryRelevantItem({
    id: "x:1",
    source: "X",
    author: "@analyst",
    createdAt: now.toISOString(),
    text: "NVDA Blackwell demand and Microsoft capex are both moving higher.",
    translation: null,
    link: "",
  }),
  true,
);

assert.equal(
  isStockSummaryRelevantItem({
    id: "x:2",
    source: "X",
    author: "@crypto",
    createdAt: now.toISOString(),
    text: "A new token campaign started; BTC and ETH liquidity improved.",
    translation: null,
    link: "",
  }),
  false,
);

assert.equal(
  isStockSummaryRelevantItem({
    id: "x:ordinary",
    source: "X",
    author: "@macro",
    createdAt: now.toISOString(),
    text: "CPI and FOMC risk are driving QQQ, SPY, SMH and premarket breadth.",
    translation: null,
    link: "",
  }),
  true,
);

assert.equal(
  isStockSummaryRelevantItem({
    id: "x:cashtag",
    source: "X",
    author: "@earnings",
    createdAt: now.toISOString(),
    text: "$AAPL earnings guidance lifted after hours, with suppliers in focus.",
    translation: null,
    link: "",
  }),
  true,
);

assert.equal(
  isStockSummaryRelevantItem({
    id: "x:crypto-cashtag",
    source: "X",
    author: "@crypto",
    createdAt: now.toISOString(),
    text: "$BTC and $ETH perp funding improved after a crypto campaign.",
    translation: null,
    link: "",
  }),
  false,
);

const prompt = buildAlphaSummaryPrompt({
  period: stocksPeriod,
  items: [
    {
      id: "x:3",
      source: "X",
      author: "@analyst",
      createdAt: now.toISOString(),
      text: "$AMD earnings and AI GPU guidance are the focus.",
      translation: null,
      link: "",
    },
  ],
});
assert.match(prompt, /STOCKS/);
assert.match(prompt, /美股/);
assert.match(prompt, /观察池/);
assert.match(prompt, /普通消息/);
assert.match(prompt, /NVDA/);
assert.match(prompt, /忽略币圈|忽略加密/);

console.log("ok - alpha summary stocks audience");
