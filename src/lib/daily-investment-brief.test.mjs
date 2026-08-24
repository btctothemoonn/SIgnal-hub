import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  DAILY_BRIEF_TOPICS,
  buildDailyBriefGdeltUrl,
  buildDailyBriefPrompt,
  collectDailyBriefCandidates,
  getDailyBriefDbPath,
  getDailyInvestmentBriefByDate,
  getDailyInvestmentBriefHistory,
  getDailyBriefPeriod,
  getLatestDailyInvestmentBrief,
  getOrCreateDailyInvestmentBrief,
  isDailyBriefDue,
  parseDailyBriefContent,
} = await import("./daily-investment-brief.ts");

assert.deepEqual(DAILY_BRIEF_TOPICS, [
  "AI / 科技产业链",
  "半导体 / 存储 / 海力士",
  "美股 / 韩股 / A股",
  "BTC / 加密货币",
  "宏观 / 地缘政治 / 原油",
]);
assert.match(getDailyBriefDbPath({}), /daily-investment-brief\.sqlite$/);

const beforeEight = new Date("2026-08-22T23:59:00.000Z");
const afterEight = new Date("2026-08-23T00:00:00.000Z");
assert.equal(getDailyBriefPeriod({ now: afterEight }).dateKey, "2026-08-23");
assert.equal(isDailyBriefDue({ now: beforeEight, env: {} }), false);
assert.equal(isDailyBriefDue({ now: afterEight, env: {} }), true);

const gdeltUrl = buildDailyBriefGdeltUrl({
  query: "domain:reuters.com (Nvidia OR bitcoin)",
  timespan: "36h",
  maxRecords: 40,
});
assert.match(gdeltUrl, /^https:\/\/api\.gdeltproject\.org\/api\/v2\/doc\/doc\?/);
assert.match(gdeltUrl, /mode=artlist/);
assert.match(gdeltUrl, /format=json/);
assert.match(gdeltUrl, /sort=datedesc/i);
assert.match(decodeURIComponent(gdeltUrl), /domain:reuters\.com/);

const fetchCalls = [];
const candidates = await collectDailyBriefCandidates({
  now: afterEight,
  env: {
    DAILY_BRIEF_LOOKBACK_HOURS: "36",
    DAILY_BRIEF_MAX_CANDIDATES: "5",
    DAILY_BRIEF_REUTERS_AP_RSS_ENABLED: "false",
    DAILY_BRIEF_BLOCKBEATS_ENABLED: "false",
  },
  fetchFn: async (url) => {
    fetchCalls.push(String(url));
    return new Response(
      JSON.stringify({
        articles: [
          {
            url: "https://www.reuters.com/technology/nvidia-ai-story",
            title: "Nvidia AI capex test approaches",
            seendate: "20260822T120000Z",
            socialimage: "https://www.reuters.com/image.jpg",
            domain: "reuters.com",
            sourcecountry: "US",
            language: "English",
          },
          {
            url: "https://www.reuters.com/technology/nvidia-ai-story?utm_source=x",
            title: "Duplicate should collapse",
            seendate: "20260822T120100Z",
            domain: "reuters.com",
          },
          {
            url: "https://apnews.com/article/markets-fed-oil",
            title: "AP market pulse covers Fed and oil",
            seendate: "20260822T130000Z",
            socialimage: "https://apnews.com/image.jpg",
            domain: "apnews.com",
          },
          {
            url: "https://example.com/finance/not-allowed",
            title: "Non allowlisted source should not enter the brief",
            seendate: "20260822T140000Z",
            socialimage: "https://example.com/image.jpg",
            domain: "example.com",
          },
        ],
      }),
    );
  },
});
assert.ok(fetchCalls.some((url) => decodeURIComponent(url).includes("domain:reuters.com")));
assert.ok(fetchCalls.some((url) => decodeURIComponent(url).includes("domain:apnews.com")));
assert.equal(candidates.length, 2);
assert.deepEqual(
  candidates.map((candidate) => candidate.source),
  ["AP News", "Reuters"],
);
assert.equal(candidates.find((candidate) => candidate.source === "Reuters")?.imageUrl, "https://www.reuters.com/image.jpg");

const independentSourceCalls = [];
const independentCandidates = await collectDailyBriefCandidates({
  now: afterEight,
  env: {
    DAILY_BRIEF_GDELT_ENABLED: "false",
    DAILY_BRIEF_MAX_CANDIDATES: "10",
    DAILY_BRIEF_BLOCKBEATS_ENABLED: "false",
    MINIMAX_WEB_SEARCH_API_KEY: "sk-cp-test-key",
    STOCKS_FMP_API_KEY: "fmp-test-key",
    STOCKS_FINNHUB_API_KEY: "finnhub-test-key",
  },
  fetchFn: async (input, init) => {
    const url = String(input);
    independentSourceCalls.push(url);
    if (url.endsWith("/v1/coding_plan/search")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const isApQuery = String(body.q).includes("AP News");
      return Response.json({
        base_resp: { status_code: 0, status_msg: "success" },
        organic: [
          isApQuery
            ? {
                title: "AP tracks fresh Federal Reserve risks",
                link: "https://apnews.com/article/fed-market-risk",
                snippet: "Policy expectations are moving bond and equity markets.",
                date: "2026-08-23T00:15:00.000Z",
              }
            : {
                title: "Reuters tracks semiconductor spending",
                link: "https://www.reuters.com/technology/ai-chip-spending",
                snippet: "AI infrastructure demand remains the main investment catalyst.",
                date: "2026-08-23T00:10:00.000Z",
              },
        ],
      });
    }
    if (url.includes("financialmodelingprep.com/stable/news/general-latest")) {
      return Response.json([
        {
          title: "Global markets prepare for central-bank signals",
          text: "Rates and the dollar are the main cross-asset variables.",
          url: "https://example.net/fmp-market-brief",
          publishedDate: "2026-08-23T00:20:00.000Z",
          site: "Market Desk",
          image: "https://example.net/fmp.jpg",
        },
      ]);
    }
    if (url.includes("finnhub.io/api/v1/news")) {
      return Response.json([
        {
          headline: "Oil volatility rises with geopolitical risk",
          summary: "Energy markets are repricing supply uncertainty.",
          url: "https://example.org/finnhub-energy",
          datetime: 1_787_444_100,
          source: "Energy Wire",
          image: "https://example.org/oil.jpg",
        },
      ]);
    }
    throw new Error(`unexpected independent source request: ${url}`);
  },
});
assert.deepEqual(
  new Set(independentCandidates.map((candidate) => candidate.source)),
  new Set(["Reuters", "AP News", "FMP", "Finnhub"]),
);
assert.ok(
  independentCandidates.some((candidate) =>
    candidate.summary?.includes("AI infrastructure demand"),
  ),
);
assert.ok(
  independentSourceCalls.some((url) => url.endsWith("/v1/coding_plan/search")),
);
assert.ok(
  independentSourceCalls.some((url) =>
    url.includes("financialmodelingprep.com/stable/news/general-latest"),
  ),
);
assert.ok(
  independentSourceCalls.some((url) => url.includes("finnhub.io/api/v1/news")),
);
assert.equal(
  independentCandidates.some((candidate) =>
    /telegram|signal|twitter|\bx\b/i.test(candidate.source),
  ),
  false,
);

const rssCalls = [];
const rssCandidates = await collectDailyBriefCandidates({
  now: afterEight,
  env: {
    DAILY_BRIEF_GDELT_ENABLED: "false",
    DAILY_BRIEF_MAX_CANDIDATES: "10",
    DAILY_BRIEF_BLOCKBEATS_ENABLED: "false",
    MINIMAX_WEB_SEARCH_API_KEY: "sk-cp-test-key",
  },
  fetchFn: async (input) => {
    const url = String(input);
    rssCalls.push(url);
    if (!url.includes("news.google.com/rss/search")) {
      throw new Error(`unexpected RSS source request: ${url}`);
    }
    const isAp = decodeURIComponent(url).includes("site:apnews.com");
    const source = isAp ? "AP News" : "Reuters";
    const sourceUrl = isAp ? "https://apnews.com" : "https://www.reuters.com";
    return new Response(`<?xml version="1.0"?><rss><channel><item>
      <title>${source} market headline</title>
      <link>https://news.google.com/rss/articles/${isAp ? "ap" : "reuters"}?oc=5</link>
      <pubDate>Sun, 23 Aug 2026 00:${isAp ? "20" : "10"}:00 GMT</pubDate>
      <description>${source} market headline</description>
      <source url="${sourceUrl}">${source}</source>
    </item></channel></rss>`);
  },
});
assert.deepEqual(
  new Set(rssCandidates.map((candidate) => candidate.source)),
  new Set(["Reuters", "AP News"]),
);
assert.equal(
  rssCalls.filter((url) => url.includes("news.google.com/rss/search")).length,
  2,
);
assert.equal(
  rssCalls.some((url) => url.endsWith("/v1/coding_plan/search")),
  false,
  "MiniMax search should only run when Reuters/AP RSS is unavailable",
);

const prompt = buildDailyBriefPrompt({
  period: getDailyBriefPeriod({ now: afterEight }),
  candidates,
  maxItems: 10,
});
assert.match(prompt, /每日投资简报/);
assert.match(prompt, /AI \/ 科技产业链/);
assert.match(prompt, /半导体 \/ 存储 \/ 海力士/);
assert.match(prompt, /最多 10 条/);
assert.match(prompt, /宁缺毋滥/);
assert.match(prompt, /不要从 Signal/);
assert.match(prompt, /Reuters/);
assert.match(prompt, /AP News/);
assert.match(prompt, /candidateIndexes/);
const independentPrompt = buildDailyBriefPrompt({
  period: getDailyBriefPeriod({ now: afterEight }),
  candidates: independentCandidates,
  maxItems: 10,
});
assert.match(independentPrompt, /AI infrastructure demand remains/);

const parsed = parseDailyBriefContent(`<think>draft</think>
\`\`\`json
{
  "title": "每日投资简报｜2026 年 8 月 23 日",
  "marketPulse": "美债、AI、原油同时牵动风险资产。",
  "items": [
    {
      "rank": 1,
      "importance": "high",
      "title": "英伟达财报成为 AI 行情关键窗口",
      "topic": "AI / 科技产业链",
      "sourceNames": ["Reuters"],
      "sourceUrls": ["https://www.reuters.com/technology/nvidia-ai-story"],
      "imageUrl": "https://example.com/nvidia.jpg",
      "whatHappened": "市场等待英伟达财报确认 AI capex。",
      "investmentImpact": "影响 HBM、算力链和高估值成长股。",
      "watchNext": "关注云厂商订单和 Blackwell 指引。"
    }
  ],
  "watchVariables": ["美债长端收益率", "BTC 8 万美元"],
  "priorityLine": "美债利率 > AI capex > 原油"
}
\`\`\``);
assert.equal(parsed.items.length, 1);
assert.equal(parsed.items[0].sourceNames[0], "Reuters");
assert.equal(
  parsed.items[0].sourceUrls[0],
  "https://www.reuters.com/technology/nvidia-ai-story",
);
assert.equal(parsed.watchVariables[1], "BTC 8 万美元");

const repairedQuotedContent = parseDailyBriefContent(`{
  "title": "每日投资简报｜2026 年 8 月 23 日",
  "marketPulse": "市场正在评估未转义的"higher for longer"利率表述",
  "items": [],
  "watchVariables": ["美债收益率"]
  "priorityLine": "利率 > AI capex"
}`);
assert.equal(
  repairedQuotedContent.marketPulse,
  '市场正在评估未转义的"higher for longer"利率表述',
);
assert.equal(repairedQuotedContent.priorityLine, "利率 > AI capex");

const dir = await mkdtemp(join(tmpdir(), "daily-brief-test-"));
const dbPath = join(dir, "brief.sqlite");
const generated = await getOrCreateDailyInvestmentBrief({
  force: true,
  now: afterEight,
  env: {
    DAILY_BRIEF_DB: dbPath,
    MINIMAX_API_KEY: "test-key",
    AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
    AI_SUMMARY_MODEL: "MiniMax-M2.7",
  },
  collectCandidates: async () => candidates,
  requestBrief: async ({ provider }) => ({
    brief: parsed,
    provider,
  }),
});
assert.equal(generated.status, "generated");
assert.equal(generated.success, true);
assert.equal(generated.brief?.items[0].title, "英伟达财报成为 AI 行情关键窗口");

const cached = await getLatestDailyInvestmentBrief({
  now: afterEight,
  env: { DAILY_BRIEF_DB: dbPath },
});
assert.equal(cached.status, "cached");
assert.equal(cached.brief?.title, "每日投资简报｜2026 年 8 月 23 日");

const nextDay = new Date("2026-08-24T00:00:00.000Z");
const failed = await getOrCreateDailyInvestmentBrief({
  force: true,
  now: nextDay,
  env: {
    DAILY_BRIEF_DB: dbPath,
    MINIMAX_API_KEY: "test-key",
    AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
    AI_SUMMARY_MODEL: "MiniMax-M2.7",
  },
  collectCandidates: async () => candidates,
  requestBrief: async () => {
    throw new Error("provider timeout");
  },
});
assert.equal(failed.status, "error");
assert.equal(failed.brief?.title, "每日投资简报｜2026 年 8 月 23 日");
assert.match(failed.error ?? "", /provider timeout/);

const recovered = await getOrCreateDailyInvestmentBrief({
  force: false,
  now: nextDay,
  env: {
    DAILY_BRIEF_DB: dbPath,
    MINIMAX_API_KEY: "test-key",
    AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
    AI_SUMMARY_MODEL: "MiniMax-M2.7",
  },
  collectCandidates: async () => candidates,
  requestBrief: async ({ provider }) => ({
    brief: {
      ...parsed,
      title: "每日投资简报｜2026 年 8 月 24 日",
      items: [
        {
          ...parsed.items[0],
          title: "恢复后的新日报",
          sourceUrls: ["https://apnews.com/article/markets-fed-oil"],
        },
      ],
    },
    provider,
  }),
});
assert.equal(recovered.status, "generated");
assert.equal(recovered.brief?.items[0].title, "恢复后的新日报");

const latestAfterFailure = await getLatestDailyInvestmentBrief({
  now: nextDay,
  env: { DAILY_BRIEF_DB: dbPath },
});
assert.equal(latestAfterFailure.status, "cached");
assert.equal(
  latestAfterFailure.brief?.items[0].title,
  "恢复后的新日报",
);

const history = await getDailyInvestmentBriefHistory({
  now: nextDay,
  days: 15,
  env: { DAILY_BRIEF_DB: dbPath },
});
assert.deepEqual(
  history.map((entry) => entry.dateKey),
  ["2026-08-24", "2026-08-23"],
);
assert.equal(history[0].itemCount, 1);
assert.equal(history[0].title, "每日投资简报｜2026 年 8 月 24 日");

const historicalBrief = await getDailyInvestmentBriefByDate({
  dateKey: "2026-08-23",
  env: { DAILY_BRIEF_DB: dbPath },
});
assert.equal(historicalBrief?.status, "cached");
assert.equal(historicalBrief?.brief?.title, "每日投资简报｜2026 年 8 月 23 日");
assert.equal(
  await getDailyInvestmentBriefByDate({
    dateKey: "not-a-date",
    env: { DAILY_BRIEF_DB: dbPath },
  }),
  null,
);

const expiredHistory = await getDailyInvestmentBriefHistory({
  now: new Date("2026-09-08T00:00:00.000Z"),
  days: 15,
  env: { DAILY_BRIEF_DB: dbPath },
});
assert.deepEqual(expiredHistory, []);

const badSourceDir = await mkdtemp(join(tmpdir(), "daily-brief-bad-source-"));
const badSourceSnapshot = await getOrCreateDailyInvestmentBrief({
  force: true,
  now: afterEight,
  env: {
    DAILY_BRIEF_DB: join(badSourceDir, "brief.sqlite"),
    MINIMAX_API_KEY: "test-key",
    AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
    AI_SUMMARY_MODEL: "MiniMax-M2.7",
  },
  collectCandidates: async () => candidates,
  requestBrief: async ({ provider }) => ({
    brief: {
      ...parsed,
      items: [
        {
          ...parsed.items[0],
          sourceUrls: ["https://example.com/finance/not-allowed"],
        },
      ],
    },
    provider,
  }),
});
assert.equal(badSourceSnapshot.status, "generated");
assert.equal(badSourceSnapshot.brief?.items.length, 0);

const indexedSourceDir = await mkdtemp(join(tmpdir(), "daily-brief-indexed-source-"));
const indexedSourceSnapshot = await getOrCreateDailyInvestmentBrief({
  force: true,
  now: afterEight,
  env: {
    DAILY_BRIEF_DB: join(indexedSourceDir, "brief.sqlite"),
    MINIMAX_API_KEY: "test-key",
    AI_SUMMARY_BASE_URL: "https://api.minimaxi.com/v1",
    AI_SUMMARY_MODEL: "MiniMax-M2.7",
  },
  collectCandidates: async () => candidates,
  requestBrief: async ({ provider }) => ({
    brief: {
      ...parsed,
      items: [
        {
          ...parsed.items[0],
          candidateIndexes: [2],
          sourceUrls: ["https://www.reuters.com/rewritten-by-the-model"],
        },
      ],
    },
    provider,
  }),
});
assert.equal(indexedSourceSnapshot.brief?.items.length, 1);
assert.deepEqual(indexedSourceSnapshot.brief?.items[0].sourceUrls, [
  "https://www.reuters.com/technology/nvidia-ai-story",
]);

console.log("ok - daily investment brief cache and generation");
