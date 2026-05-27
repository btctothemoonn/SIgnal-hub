import assert from "node:assert/strict";
import { ALPHA_RESEARCH_STOCKS } from "./alpha-research-pool.ts";
import {
  buildMockStocksCatalystSnapshot,
  buildStocksCatalystSnapshotFromItems,
  mergeStocksCatalystSnapshot,
  parseAlphaVantageNewsPayload,
  parseFmpStockNewsPayload,
  parseFinnhubCompanyNewsPayload,
  parseGoogleNewsRss,
  parsePatreonPostApiResponse,
  parsePatreonPostsPage,
  parsePolygonNewsPayload,
  parseYahooFinanceRss,
} from "./stocks-catalyst-data.ts";

const polygonItems = parsePolygonNewsPayload({
  results: [
    {
      id: "polygon-1",
      title: "AMD lifts AI accelerator guidance",
      description: "MI series revenue estimate moves higher after earnings.",
      article_url: "https://polygon.example.com/amd",
      published_utc: "2026-05-07T02:00:00Z",
      author: "Jane Smith",
      publisher: { name: "Polygon Newswire" },
      tickers: ["AMD"],
    },
  ],
});
assert.equal(polygonItems[0].source, "Polygon");
assert.equal(polygonItems[0].sourceRole, "external");
assert.equal(polygonItems[0].tickers?.[0], "AMD");

const fmpItems = parseFmpStockNewsPayload([
  {
    symbol: "NVDA",
    title: "Nvidia supplier checks improve",
    text: "Cloud demand remains strong.",
    url: "https://fmp.example.com/nvda",
    publishedDate: "2026-05-07 01:00:00",
    site: "FMP Source",
  },
]);
assert.equal(fmpItems[0].source, "FMP");
assert.equal(fmpItems[0].sourceRole, "external");
assert.equal(fmpItems[0].tickers?.[0], "NVDA");

const fmpArticleItems = parseFmpStockNewsPayload([
  {
    title: "Nvidia receives upgrade amid AI growth",
    content: "Analysts cite Blackwell demand.",
    link: "https://fmp.example.com/articles/nvda",
    date: "2026-05-14 21:11:35",
    tickers: "NASDAQ:NVDA",
    site: "Financial Modeling Prep",
  },
]);
assert.equal(fmpArticleItems[0].link, "https://fmp.example.com/articles/nvda");
assert.equal(fmpArticleItems[0].tickers?.[0], "NVDA");

const yahooItems = parseYahooFinanceRss(
  `<?xml version="1.0"?><rss><channel><item><title><![CDATA[NVDA capex story improves]]></title><link>https://finance.yahoo.com/news/nvda</link><pubDate>Thu, 07 May 2026 01:30:00 GMT</pubDate><description><![CDATA[Cloud capex remains strong.]]></description></item></channel></rss>`,
  "NVDA",
);
assert.equal(yahooItems[0].source, "Yahoo Finance");
assert.equal(yahooItems[0].sourceRole, "external");
assert.equal(yahooItems[0].tickers?.[0], "NVDA");

const alphaVantageItems = parseAlphaVantageNewsPayload({
  feed: [
    {
      title: "Nvidia AI demand remains strong",
      url: "https://alphavantage.example.com/nvda",
      time_published: "20260507T013000",
      summary: "Cloud capex checks remain constructive.",
      source: "Alpha News",
      ticker_sentiment: [
        {
          ticker: "NVDA",
          relevance_score: "0.92",
          ticker_sentiment_score: "0.35",
        },
      ],
    },
  ],
});
assert.equal(alphaVantageItems[0].source, "Alpha Vantage");
assert.equal(alphaVantageItems[0].sourceRole, "external");
assert.equal(alphaVantageItems[0].tickers?.[0], "NVDA");

const finnhubItems = parseFinnhubCompanyNewsPayload(
  [
    {
      id: 1001,
      headline: "Nvidia supplier checks improve",
      summary: "Cloud demand remains strong.",
      url: "https://finnhub.example.com/nvda",
      datetime: 1778117400,
      source: "Finnhub Source",
      related: "NVDA",
    },
  ],
  "NVDA",
);
assert.equal(finnhubItems[0].source, "Finnhub");
assert.equal(finnhubItems[0].sourceRole, "external");
assert.equal(finnhubItems[0].tickers?.[0], "NVDA");

const googleItems = parseGoogleNewsRss(
  `<?xml version="1.0"?><rss><channel><item><title>Nvidia stock rises - Reuters</title><link>https://news.google.com/rss/articles/nvda</link><pubDate>Thu, 07 May 2026 01:35:00 GMT</pubDate><source url="https://reuters.com">Reuters</source><description>Nvidia shares rise as AI demand improves.</description></item></channel></rss>`,
  "NVDA",
);
assert.equal(googleItems[0].source, "Google News");
assert.equal(googleItems[0].author, "Reuters");
assert.equal(googleItems[0].tickers?.[0], "NVDA");

const patreonItems = parsePatreonPostsPage(
  `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: {
      pageProps: {
        posts: [
          {
            id: "post-1",
            title: "NVDA inference demand and Micron HBM follow-through",
            url: "https://www.patreon.com/posts/post-1",
            published_at: "2026-05-12T12:00:00.000Z",
            excerpt:
              "NVDA demand remains strong and Micron HBM supply is tightening.",
            content: "paid full body ".repeat(200),
          },
        ],
      },
    },
  })}</script></html>`,
  {
    creatorName: "bboczeng",
    sourceUrl: "https://www.patreon.com/c/bboczeng/posts",
    maxPosts: 5,
  },
);
assert.equal(patreonItems[0].source, "Patreon");
assert.equal(patreonItems[0].sourceRole, "subscription");
assert.equal(patreonItems[0].author, "bboczeng");
assert.equal(patreonItems[0].link, "https://www.patreon.com/posts/post-1");
assert.ok(patreonItems[0].text.includes("Micron HBM"));
assert.ok(!patreonItems[0].text.includes("paid full body paid full body"));

const patreonApiItem = parsePatreonPostApiResponse(
  JSON.stringify({
    data: {
      id: "157941919",
      type: "post",
      attributes: {
        title: "MU and SNDK storage cycle plan",
        published_at: "2026-05-12T13:00:00.000Z",
        url: "https://www.patreon.com/posts/mu-sndk-157941919",
        teaser_text_json_string: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Full subscriber note: MU keeps HBM pricing power.",
                },
              ],
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "SNDK benefits from NAND contract price resets.",
                },
              ],
            },
          ],
        }),
      },
    },
  }),
  {
    creatorName: "bboczeng",
    sourceUrl: "https://www.patreon.com/posts/mu-sndk-157941919",
  },
);
assert.equal(patreonApiItem?.source, "Patreon");
assert.ok(patreonApiItem?.text.includes("Full subscriber note"));
assert.ok(patreonApiItem?.text.includes("SNDK benefits"));

const subscriptionSnapshot = buildStocksCatalystSnapshotFromItems({
  stocks: ALPHA_RESEARCH_STOCKS,
  items: patreonItems,
  generatedAt: "2026-05-12T12:05:00.000Z",
});
assert.equal(subscriptionSnapshot.source, "live");
assert.equal(subscriptionSnapshot.provider, "subscription-research");
assert.equal(subscriptionSnapshot.catalysts.NVDA[0].source, "Patreon");
assert.equal(subscriptionSnapshot.catalysts.NVDA[0].sourceRole, "subscription");
assert.ok(subscriptionSnapshot.catalysts.NVDA[0].fullSummary.includes("Micron HBM"));
assert.ok(
  subscriptionSnapshot.catalysts.NVDA[0].fullSummary.length >=
    subscriptionSnapshot.catalysts.NVDA[0].summary.length,
);

const rawSubscriberArticle = [
  "Hello, this is the full subscriber note for today.",
  "MU keeps HBM pricing power because supply remains tight and cloud demand is still improving.",
  "SNDK benefits from NAND contract price resets, while WDC shipment discipline supports the storage cycle.",
  "The main risk is that storage equities have already priced in too much near-term optimism.",
  "This filler sentence should never be copied into the expanded summary. ".repeat(30),
].join("\n");
const detailedSubscriptionSnapshot = buildStocksCatalystSnapshotFromItems({
  stocks: ALPHA_RESEARCH_STOCKS.filter((stock) =>
    ["MU", "SNDK"].includes(stock.ticker),
  ),
  items: [
    {
      id: "patreon:detailed-storage-cycle",
      source: "Patreon",
      sourceRole: "subscription",
      author: "bboczeng",
      createdAt: "2026-05-12T14:00:00.000Z",
      text: `Storage cycle detailed note\n${rawSubscriberArticle}`,
      translation: null,
      link: "https://www.patreon.com/posts/detailed-storage-cycle",
      tickers: [],
    },
  ],
  generatedAt: "2026-05-12T14:05:00.000Z",
});
const detailedSubscriptionReport = detailedSubscriptionSnapshot.catalysts.MU[0];
assert.ok(detailedSubscriptionReport.fullSummary?.startsWith("\u6838\u5fc3\u8981\u70b9"));
assert.ok(detailedSubscriptionReport.fullSummary.includes("HBM pricing power"));
assert.ok(
  detailedSubscriptionReport.fullSummary.length < rawSubscriberArticle.length / 2,
);
assert.ok(
  !detailedSubscriptionReport.fullSummary.includes(
    "This filler sentence should never be copied",
  ),
);

const storageSubscriptionSnapshot = buildStocksCatalystSnapshotFromItems({
  stocks: ALPHA_RESEARCH_STOCKS,
  items: [
    {
      id: "patreon:storage-cycle",
      source: "Patreon",
      sourceRole: "subscription",
      author: "bboczeng",
      createdAt: "2026-05-12T13:00:00.000Z",
      text: "NAND and SSD pricing checks are moving higher as storage demand improves.",
      translation: null,
      link: "https://www.patreon.com/posts/storage-cycle",
      tickers: [],
    },
  ],
  generatedAt: "2026-05-12T13:05:00.000Z",
});
assert.equal(storageSubscriptionSnapshot.catalysts.DRAM[0].sourceRole, "subscription");
assert.equal(storageSubscriptionSnapshot.catalysts.MU[0].sourceRole, "subscription");
assert.equal(storageSubscriptionSnapshot.catalysts.SNDK[0].sourceRole, "subscription");
assert.equal(storageSubscriptionSnapshot.catalysts.WDC[0].sourceRole, "subscription");

const subscriptionHistorySnapshot = buildStocksCatalystSnapshotFromItems({
  stocks: ALPHA_RESEARCH_STOCKS.filter((stock) => stock.ticker === "NVDA"),
  items: Array.from({ length: 8 }, (_, index) => ({
    id: `patreon:nvda-history-${index}`,
    source: "Patreon",
    sourceRole: "subscription",
    author: "bboczeng",
    createdAt: `2026-05-${String(10 + index).padStart(2, "0")}T12:00:00.000Z`,
    text: `NVDA subscriber history note ${index} mentions AI demand.`,
    translation: null,
    link: `https://www.patreon.com/posts/nvda-history-${index}`,
    tickers: ["NVDA"],
  })),
  generatedAt: "2026-05-20T12:00:00.000Z",
});
assert.equal(subscriptionHistorySnapshot.catalysts.NVDA.length, 8);

const sourceItems = [
  {
    id: "polygon:article-1",
    source: "Polygon",
    sourceRole: "external",
    author: "MarketWatch",
    createdAt: "2026-05-07T03:45:00.000Z",
    text: "Nvidia Blackwell demand checks raised again as cloud capex stays strong.",
    translation: null,
    link: "https://news.example.com/nvda",
    tickers: ["NVDA"],
  },
  {
    id: "x:1",
    source: "X",
    sourceRole: "supplemental",
    author: "@semianalyst",
    createdAt: "2026-05-07T03:30:00.000Z",
    text: "$NVDA Blackwell demand checks raised again as cloud capex stays strong.",
    translation: null,
    link: "https://x.com/semianalyst/status/1",
    tickers: [],
  },
  {
    id: "telegram:1",
    source: "Telegram",
    sourceRole: "supplemental",
    author: "US Stocks Desk",
    createdAt: "2026-05-07T03:35:00.000Z",
    text: "AMD earnings guide raised, MI series revenue estimate moves higher.",
    translation: "AMD earnings guidance was raised and MI-series revenue estimates moved higher.",
    link: "https://t.me/stocks/1",
    tickers: [],
  },
  {
    id: "x:2",
    source: "X",
    sourceRole: "supplemental",
    author: "@crypto",
    createdAt: "2026-05-07T03:40:00.000Z",
    text: "$BTC ETF flow update.",
    translation: null,
    link: "https://x.com/crypto/status/2",
    tickers: [],
  },
];

const liveSnapshot = buildStocksCatalystSnapshotFromItems({
  stocks: ALPHA_RESEARCH_STOCKS,
  items: sourceItems,
  generatedAt: "2026-05-07T04:00:00.000Z",
});

assert.equal(liveSnapshot.source, "live");
assert.equal(liveSnapshot.provider, "external-plus-supplemental");
assert.equal(liveSnapshot.catalysts.NVDA.length, 2);
assert.equal(liveSnapshot.catalysts.NVDA[0].type, "product");
assert.equal(liveSnapshot.catalysts.NVDA[0].source, "Polygon");
assert.equal(liveSnapshot.catalysts.NVDA[0].sourceRole, "external");
assert.equal(liveSnapshot.catalysts.AMD.length, 1);
assert.equal(liveSnapshot.catalysts.AMD[0].type, "earnings");
assert.equal(
  liveSnapshot.catalysts.AMD[0].summary,
  "AMD earnings guidance was raised and MI-series revenue estimates moved higher.",
);
assert.equal(liveSnapshot.catalysts.BTC, undefined);

const longCatalystItems = Array.from({ length: 6 }, (_, index) => ({
  id: `polygon:long-${index}`,
  source: "Polygon",
  sourceRole: "external",
  author: "MarketWire",
  createdAt: `2026-05-07T0${index}:00:00.000Z`,
  text: [
    `NVDA catalyst ${index} keeps AI demand checks in focus`,
    "Cloud capex remains strong, hyperscaler purchase orders keep moving higher, Blackwell supply checks are improving, and investors are watching whether revenue guidance can reset above the current consensus range. ".repeat(4),
  ].join("\n"),
  translation: null,
  link: `https://news.example.com/nvda-${index}`,
  tickers: ["NVDA"],
}));

const roomySnapshot = buildStocksCatalystSnapshotFromItems({
  stocks: ALPHA_RESEARCH_STOCKS,
  items: longCatalystItems,
  generatedAt: "2026-05-07T06:00:00.000Z",
});
assert.equal(roomySnapshot.catalysts.NVDA.length, 5);
assert.ok(roomySnapshot.catalysts.NVDA[0].summary.length > 360);
assert.ok(roomySnapshot.catalysts.NVDA[0].summary.length <= 423);

const externalTickerSnapshot = buildStocksCatalystSnapshotFromItems({
  stocks: ALPHA_RESEARCH_STOCKS,
  items: [
    {
      id: "alphavantage:mitk",
      source: "Alpha Vantage",
      sourceRole: "external",
      author: "Alpha News",
      createdAt: "2026-05-07T04:10:00.000Z",
      text: "Microsoft earnings beat, but this Alpha Vantage article is tagged to MITK only.",
      translation: null,
      link: "https://alphavantage.example.com/mitk",
      tickers: ["MITK"],
    },
  ],
  generatedAt: "2026-05-07T04:15:00.000Z",
});
assert.equal(externalTickerSnapshot.catalysts.MSFT, undefined);

const mockSnapshot = buildMockStocksCatalystSnapshot(ALPHA_RESEARCH_STOCKS);
assert.equal(mockSnapshot.source, "mock");
assert.equal(mockSnapshot.catalysts.NVDA[0].source, "mock");

const merged = mergeStocksCatalystSnapshot(ALPHA_RESEARCH_STOCKS, liveSnapshot);
const nvda = merged.find((stock) => stock.ticker === "NVDA");
const tsm = merged.find((stock) => stock.ticker === "TSM");
assert.equal(nvda?.catalysts[0].source, "Polygon");
assert.equal(tsm?.catalysts[0].source, undefined);

console.log("ok - stocks catalyst data");
