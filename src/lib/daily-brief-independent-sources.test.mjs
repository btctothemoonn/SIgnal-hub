import assert from "node:assert/strict";

const { collectIndependentDailyBriefCandidates } = await import(
  "./daily-brief-independent-sources.ts"
);

const now = new Date("2026-08-24T00:00:00.000Z");

function rss(items) {
  return `<?xml version="1.0"?><rss><channel>${items
    .map(
      (item) => `<item>
        <title><![CDATA[${item.title}]]></title>
        <description><![CDATA[${item.summary}]]></description>
        <link>${item.url}</link>
        <pubDate>${item.publishedAt.toUTCString()}</pubDate>
        <guid>${item.url}</guid>
      </item>`,
    )
    .join("")}</channel></rss>`;
}

function feedItems({ count, prefix, path, startHoursAgo }) {
  return Array.from({ length: count }, (_, index) => ({
    title: `${prefix} ${index + 1}`,
    summary: `${prefix} 的完整摘要 ${index + 1}`,
    url: `https://www.theblockbeats.info/${path}/${index + 1}`,
    publishedAt: new Date(
      now.getTime() - (startHoursAgo + index * 0.1) * 60 * 60 * 1000,
    ),
  }));
}

const important = feedItems({
  count: 20,
  prefix: "SEC 批准比特币 ETF 重要进展",
  path: "flash/important",
  startHoursAgo: 20,
});
const latest = feedItems({
  count: 20,
  prefix: "社区活动普通更新",
  path: "flash/latest",
  startHoursAgo: 1,
});
const articles = feedItems({
  count: 8,
  prefix: "市场周期深度研究",
  path: "news/article",
  startHoursAgo: 10,
});

const requestedUrls = [];
const candidates = await collectIndependentDailyBriefCandidates({
  now,
  env: {
    DAILY_BRIEF_REUTERS_AP_RSS_ENABLED: "false",
    DAILY_BRIEF_MINIMAX_SEARCH_ENABLED: "false",
    DAILY_BRIEF_FMP_ENABLED: "false",
    DAILY_BRIEF_FINNHUB_ENABLED: "false",
    DAILY_BRIEF_BLOCKBEATS_ENABLED: "true",
  },
  fetchFn: async (input, init) => {
    const url = String(input);
    requestedUrls.push(url);
    assert.equal(init?.headers?.language, "cn");
    if (url.endsWith("/newsflash")) {
      return new Response(rss([...latest, ...important]));
    }
    if (url.endsWith("/article")) {
      return new Response(rss(articles));
    }
    throw new Error(`unexpected request: ${url}`);
  },
});

assert.deepEqual(
  requestedUrls.sort(),
  [
    "https://api.theblockbeats.news/v2/rss/article",
    "https://api.theblockbeats.news/v2/rss/newsflash",
  ],
);
assert.equal(candidates.length, 30);
assert.equal(
  candidates.filter((candidate) => candidate.title.startsWith("SEC 批准")).length,
  20,
);
assert.equal(
  candidates.filter((candidate) => candidate.title.startsWith("社区活动")).length,
  5,
);
assert.equal(
  candidates.filter((candidate) => candidate.title.startsWith("市场周期")).length,
  5,
);
assert.ok(candidates.every((candidate) => candidate.source === "BlockBeats"));

const fallbackUrls = [];
const fallbackCandidates = await collectIndependentDailyBriefCandidates({
  now,
  env: {
    DAILY_BRIEF_REUTERS_AP_RSS_ENABLED: "false",
    DAILY_BRIEF_MINIMAX_SEARCH_ENABLED: "false",
    DAILY_BRIEF_FMP_ENABLED: "false",
    DAILY_BRIEF_FINNHUB_ENABLED: "false",
    DAILY_BRIEF_BLOCKBEATS_ENABLED: "true",
  },
  fetchFn: async (input) => {
    const url = String(input);
    fallbackUrls.push(url);
    if (url.startsWith("https://api.theblockbeats.news/")) {
      return Response.json({ status: 0, message: "", data: [] });
    }
    if (url.includes("news.google.com/rss/search")) {
      return new Response(rss([...latest, ...important, ...articles]));
    }
    throw new Error(`unexpected fallback request: ${url}`);
  },
});
assert.equal(fallbackCandidates.length, 30);
assert.ok(
  fallbackUrls.some((url) => url.includes("news.google.com/rss/search")),
);
assert.equal(
  fallbackCandidates.filter((candidate) => candidate.title.startsWith("SEC 批准"))
    .length,
  20,
);

console.log("ok - BlockBeats RSS keeps important, latest, and deep content balanced");
