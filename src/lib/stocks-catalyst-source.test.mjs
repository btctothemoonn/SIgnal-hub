import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { ALPHA_RESEARCH_STOCKS } from "./alpha-research-pool.ts";
import {
  fetchExternalCatalystItems,
  fetchPatreonSubscriptionItems,
  getStocksCatalystSnapshot,
} from "./stocks-catalyst-source.ts";

const fetchImpl = async (url) => {
  assert.ok(String(url).includes("feeds.finance.yahoo.com"));
  return new Response(
    `<?xml version="1.0"?><rss><channel><item><title>NVDA supplier checks raised</title><link>https://finance.yahoo.com/news/nvda</link><pubDate>Thu, 07 May 2026 01:30:00 GMT</pubDate><description>Cloud capex remains strong.</description></item></channel></rss>`,
    { status: 200 },
  );
};

const snapshot = await getStocksCatalystSnapshot({
  stocks: ALPHA_RESEARCH_STOCKS.filter((stock) => stock.ticker === "NVDA"),
  fetchImpl,
  env: {
    STOCKS_NEWS_PROVIDER: "yahoo",
    STOCKS_INCLUDE_LOCAL_SIGNALS: "false",
    STOCKS_NEWS_TRANSLATE_ENABLED: "false",
  },
});

assert.equal(snapshot.source, "live");
assert.equal(snapshot.provider, "external-news");
assert.equal(snapshot.catalysts.NVDA[0].source, "Yahoo Finance");
assert.equal(snapshot.catalysts.NVDA[0].sourceRole, "external");

const polygonAliasUrls = [];
const polygonAliasFetch = async (url) => {
  polygonAliasUrls.push(String(url));
  return Response.json({
    results: [
      {
        id: "m-1",
        title: "NVDA news from Massive",
        article_url: "https://massive.example.com/nvda",
        published_utc: "2026-05-07T02:00:00Z",
        publisher: { name: "Massive" },
        tickers: ["NVDA"],
      },
    ],
  });
};

const external = await fetchExternalCatalystItems({
  stocks: ALPHA_RESEARCH_STOCKS.filter((stock) => stock.ticker === "NVDA"),
  fetchImpl: polygonAliasFetch,
  env: {
    STOCKS_NEWS_PROVIDER: "polygon",
    STOCKS_MASSIVE_API_KEY: "massive-key",
    STOCKS_POLYGON_BASE_URL: "https://api.massive.com",
    STOCKS_NEWS_TRANSLATE_ENABLED: "false",
  },
});
assert.equal(external.items[0].source, "Polygon");
assert.ok(polygonAliasUrls[0].startsWith("https://api.massive.com/"));
assert.ok(polygonAliasUrls[0].includes("apiKey=massive-key"));

const fmpTickerUrls = [];
const fmpTickerFetch = async (url) => {
  fmpTickerUrls.push(String(url));
  return Response.json([
    {
      symbol: "NVDA",
      title: "NVDA ticker-specific FMP news",
      text: "Demand remains firm.",
      url: "https://fmp.example.com/nvda",
      publishedDate: "2026-05-07 01:00:00",
      site: "FMP",
    },
  ]);
};

const fmpExternal = await fetchExternalCatalystItems({
  stocks: ALPHA_RESEARCH_STOCKS.filter((stock) => stock.ticker === "NVDA"),
  fetchImpl: fmpTickerFetch,
  env: {
    STOCKS_NEWS_PROVIDER: "fmp",
    STOCKS_FMP_API_KEY: "fmp-key",
    STOCKS_FMP_BY_TICKER: "true",
    STOCKS_NEWS_TRANSLATE_ENABLED: "false",
  },
});
assert.equal(fmpExternal.items.length, 1);
assert.equal(fmpExternal.items[0].source, "FMP");
assert.ok(fmpTickerUrls[0].includes("symbols=NVDA"));

const cappedPolygonUrls = [];
const cappedPolygonFetch = async (url) => {
  cappedPolygonUrls.push(String(url));
  return Response.json({
    results: [
      {
        id: `polygon-${cappedPolygonUrls.length}`,
        title: "Capped Polygon news",
        article_url: `https://polygon.example.com/${cappedPolygonUrls.length}`,
        published_utc: "2026-05-07T02:00:00Z",
        publisher: { name: "Polygon" },
        tickers: ["NVDA"],
      },
    ],
  });
};

await fetchExternalCatalystItems({
  stocks: ALPHA_RESEARCH_STOCKS.slice(0, 4),
  fetchImpl: cappedPolygonFetch,
  env: {
    STOCKS_NEWS_PROVIDER: "polygon",
    STOCKS_MASSIVE_API_KEY: "massive-key",
    STOCKS_POLYGON_MAX_TICKERS: "2",
    STOCKS_NEWS_TRANSLATE_ENABLED: "false",
  },
});
assert.equal(cappedPolygonUrls.length, 2);

const fmpBatchUrls = [];
const fmpBatchFetch = async (url) => {
  fmpBatchUrls.push(String(url));
  const symbols =
    new URL(String(url)).searchParams.get("symbols")?.split(",") ?? [];
  return Response.json(
    symbols.map((symbol) => ({
      symbol,
      title: `${symbol} batched FMP news`,
      text: "Demand remains firm.",
      url: `https://fmp.example.com/${symbol.toLowerCase()}`,
      publishedDate: "2026-05-07 01:00:00",
      site: "FMP",
    })),
  );
};

const fmpBatchExternal = await fetchExternalCatalystItems({
  stocks: ALPHA_RESEARCH_STOCKS.slice(0, 5),
  fetchImpl: fmpBatchFetch,
  env: {
    STOCKS_NEWS_PROVIDER: "fmp",
    STOCKS_FMP_API_KEY: "fmp-key",
    STOCKS_FMP_BY_TICKER: "true",
    STOCKS_FMP_BATCH_SIZE: "3",
    STOCKS_NEWS_TRANSLATE_ENABLED: "false",
  },
});
assert.equal(fmpBatchUrls.length, 2);
assert.equal(new URL(fmpBatchUrls[0]).searchParams.get("symbols"), "NVDA,TSM,ASML");
assert.equal(fmpBatchExternal.items.length, 5);

const fmpFallbackUrls = [];
const fmpFallbackFetch = async (url) => {
  fmpFallbackUrls.push(String(url));
  if (String(url).includes("symbols=")) {
    return new Response("rate limit", { status: 429 });
  }
  return Response.json([
    {
      symbol: "NVDA",
      title: "FMP latest fallback news",
      text: "Fallback still finds stock news.",
      url: "https://fmp.example.com/latest-fallback",
      publishedDate: "2026-05-07 01:00:00",
      site: "FMP",
    },
  ]);
};

const fmpFallbackExternal = await fetchExternalCatalystItems({
  stocks: ALPHA_RESEARCH_STOCKS.filter((stock) => stock.ticker === "NVDA"),
  fetchImpl: fmpFallbackFetch,
  env: {
    STOCKS_NEWS_PROVIDER: "fmp",
    STOCKS_FMP_API_KEY: "fmp-key",
    STOCKS_FMP_BY_TICKER: "true",
    STOCKS_NEWS_TRANSLATE_ENABLED: "false",
  },
});
assert.equal(fmpFallbackExternal.items.length, 1);
assert.ok(fmpFallbackUrls.some((url) => url.includes("stock-latest")));

const alphaVantageUrls = [];
const alphaVantageFetch = async (url) => {
  alphaVantageUrls.push(String(url));
  const tickers =
    new URL(String(url)).searchParams.get("tickers")?.split(",") ?? [];
  return Response.json({
    feed: tickers.map((ticker) => ({
      title: `${ticker} Alpha Vantage news`,
      url: `https://alphavantage.example.com/${ticker.toLowerCase()}`,
      time_published: "20260507T013000",
      summary: "AI capex story remains constructive.",
      source: "Alpha Vantage Source",
      ticker_sentiment: [{ ticker }],
    })),
  });
};

const alphaVantageExternal = await fetchExternalCatalystItems({
  stocks: ALPHA_RESEARCH_STOCKS.slice(0, 4),
  fetchImpl: alphaVantageFetch,
  env: {
    STOCKS_NEWS_PROVIDER: "alpha-vantage",
    STOCKS_ALPHA_VANTAGE_API_KEY: "alpha-key",
    STOCKS_ALPHA_VANTAGE_MAX_TICKERS: "3",
    STOCKS_ALPHA_VANTAGE_BATCH_SIZE: "2",
    STOCKS_NEWS_TRANSLATE_ENABLED: "false",
  },
});
assert.equal(alphaVantageUrls.length, 2);
assert.equal(
  new URL(alphaVantageUrls[0]).searchParams.get("tickers"),
  "NVDA,TSM",
);
assert.equal(alphaVantageExternal.items.length, 3);
assert.equal(alphaVantageExternal.items[0].source, "Alpha Vantage");

const finnhubUrls = [];
const finnhubExternal = await fetchExternalCatalystItems({
  stocks: ALPHA_RESEARCH_STOCKS.filter((stock) => stock.ticker === "NVDA"),
  fetchImpl: async (url) => {
    finnhubUrls.push(String(url));
    return Response.json([
      {
        id: 101,
        headline: "NVDA Finnhub company news",
        summary: "Demand remains firm.",
        url: "https://finnhub.example.com/nvda",
        datetime: 1778117400,
        source: "Finnhub Source",
        related: "NVDA",
      },
    ]);
  },
  env: {
    STOCKS_NEWS_PROVIDER: "finnhub",
    STOCKS_FINNHUB_API_KEY: "finnhub-key",
    STOCKS_NEWS_TRANSLATE_ENABLED: "false",
  },
});
assert.equal(finnhubExternal.items.length, 1);
assert.equal(finnhubExternal.items[0].source, "Finnhub");
assert.ok(finnhubUrls[0].includes("company-news"));
assert.ok(finnhubUrls[0].includes("symbol=NVDA"));

const googleUrls = [];
const googleExternal = await fetchExternalCatalystItems({
  stocks: ALPHA_RESEARCH_STOCKS.filter((stock) => stock.ticker === "NVDA"),
  fetchImpl: async (url) => {
    googleUrls.push(String(url));
    return new Response(
      `<?xml version="1.0"?><rss><channel><item><title>NVDA Google News fallback</title><link>https://news.google.com/rss/articles/nvda</link><pubDate>Thu, 07 May 2026 01:30:00 GMT</pubDate><source url="https://reuters.com">Reuters</source><description>Cloud demand remains firm.</description></item></channel></rss>`,
      { status: 200 },
    );
  },
  env: {
    STOCKS_NEWS_PROVIDER: "google-news",
    STOCKS_GOOGLE_NEWS_MAX_TICKERS: "1",
    STOCKS_NEWS_TRANSLATE_ENABLED: "false",
  },
});
assert.equal(googleExternal.items.length, 1);
assert.equal(googleExternal.items[0].source, "Google News");
assert.ok(googleUrls[0].includes("news.google.com/rss/search"));

let autoCalls = [];
const aggregateFetch = async (url) => {
  autoCalls.push(String(url));
  if (String(url).includes("reference/news")) {
    return new Response("rate limit", { status: 429 });
  }
  if (String(url).includes("financialmodelingprep.com")) {
    return new Response("rate limit", { status: 429 });
  }
  if (String(url).includes("alphavantage.co")) {
    return Response.json({
      feed: [
        {
          title: "Alpha Vantage fallback news",
          url: "https://alphavantage.example.com/fallback",
          time_published: "20260507T013000",
          source: "Alpha Vantage",
          ticker_sentiment: [{ ticker: "NVDA" }],
        },
      ],
    });
  }
  if (String(url).includes("finnhub.io")) {
    return Response.json([
      {
        id: 102,
        headline: "Finnhub fallback news",
        summary: "Company news remains available.",
        url: "https://finnhub.example.com/fallback",
        datetime: 1778117400,
        source: "Finnhub",
        related: "NVDA",
      },
    ]);
  }
  return new Response(
    `<?xml version="1.0"?><rss><channel><item><title>Yahoo fallback news</title><link>https://finance.yahoo.com/news/nvda</link><pubDate>Thu, 07 May 2026 01:30:00 GMT</pubDate></item></channel></rss>`,
    { status: 200 },
  );
};

const aggregateExternal = await fetchExternalCatalystItems({
  stocks: ALPHA_RESEARCH_STOCKS.filter((stock) => stock.ticker === "NVDA"),
  fetchImpl: aggregateFetch,
  env: {
    STOCKS_NEWS_PROVIDER: "auto",
    STOCKS_MASSIVE_API_KEY: "massive-key",
    STOCKS_FINNHUB_API_KEY: "finnhub-key",
    STOCKS_FMP_API_KEY: "fmp-key",
    STOCKS_ALPHA_VANTAGE_API_KEY: "alpha-key",
    STOCKS_FMP_BY_TICKER: "true",
    STOCKS_NEWS_TRANSLATE_ENABLED: "false",
  },
});
assert.equal(aggregateExternal.items.length, 3);
assert.ok(aggregateExternal.errors.some((error) => error.includes("429")));
assert.ok(!autoCalls.some((url) => url.includes("financialmodelingprep.com")));
assert.ok(autoCalls.some((url) => url.includes("finnhub.io")));
assert.ok(autoCalls.some((url) => url.includes("alphavantage.co")));
assert.ok(autoCalls.some((url) => url.includes("feeds.finance.yahoo.com")));
assert.ok(autoCalls.some((url) => url.includes("news.google.com")));

const translatedItems = await fetchExternalCatalystItems({
  stocks: ALPHA_RESEARCH_STOCKS.filter((stock) => stock.ticker === "NVDA"),
  fetchImpl,
  env: {
    STOCKS_NEWS_PROVIDER: "yahoo",
    STOCKS_NEWS_TRANSLATE_ENABLED: "true",
    STOCKS_NEWS_TRANSLATE_MAX_ITEMS: "1",
  },
  translateImpl: async (text, options) => {
    assert.ok(text.includes("NVDA supplier checks raised"));
    assert.equal(options?.targetLanguage, "zh-CN");
    assert.equal(options?.cacheNamespace, "stocks-news");
    return {
      provider: "minimax",
      sourceLanguage: "en",
      targetLanguage: "zh-CN",
      text: "NVDA 供应商检查上修，云资本开支仍然强劲。",
    };
  },
});
assert.equal(
  translatedItems.items[0].translation,
  "NVDA 供应商检查上修，云资本开支仍然强劲。",
);

const slowTranslationStart = Date.now();
const slowTranslationItems = await fetchExternalCatalystItems({
  stocks: ALPHA_RESEARCH_STOCKS.filter((stock) => stock.ticker === "NVDA"),
  fetchImpl,
  env: {
    STOCKS_NEWS_PROVIDER: "yahoo",
    STOCKS_NEWS_TRANSLATE_ENABLED: "true",
    STOCKS_NEWS_TRANSLATE_MAX_ITEMS: "1",
    STOCKS_NEWS_TRANSLATE_TIMEOUT_MS: "10",
  },
  translateImpl: () =>
    new Promise((resolve) => {
      setTimeout(
        () =>
          resolve({
            provider: "minimax",
            sourceLanguage: "en",
            targetLanguage: "zh-CN",
            text: "这条慢翻译不应该阻塞接口。",
          }),
        1000,
      );
    }),
});
assert.equal(slowTranslationItems.items[0].translation, null);
assert.ok(Date.now() - slowTranslationStart < 500);

const originalFetch = globalThis.fetch;
const tempCachePath = join(
  process.cwd(),
  ".signal-hub",
  `stocks-news-translation-cache-test-${process.pid}.json`,
);
rmSync(tempCachePath, { force: true });
let cacheFetchCalls = 0;
globalThis.fetch = async () => {
  cacheFetchCalls += 1;
  return new Response(
    `<?xml version="1.0"?><rss><channel><item><title>NVDA cache translation test</title><link>https://finance.yahoo.com/news/nvda-cache-translation-test-${cacheFetchCalls}</link><pubDate>Thu, 07 May 2026 01:30:00 GMT</pubDate><description>Cloud capex remains strong.</description></item></channel></rss>`,
    { status: 200 },
  );
};

try {
  const cacheEnv = {
    STOCKS_NEWS_PROVIDER: "yahoo",
    STOCKS_NEWS_CACHE_PATH: tempCachePath,
    STOCKS_NEWS_CACHE_MS: "600000",
    STOCKS_INCLUDE_LOCAL_SIGNALS: "false",
    STOCKS_NEWS_TRANSLATE_ENABLED: "true",
    STOCKS_NEWS_TRANSLATE_TIMEOUT_MS: "1",
    STOCKS_NEWS_ITEMS_PER_TICKER: "3",
    STOCKS_YAHOO_NEWS_MAX_TICKERS: "1",
  };
  await fetchExternalCatalystItems({
    stocks: ALPHA_RESEARCH_STOCKS.filter((stock) => stock.ticker === "NVDA"),
    env: cacheEnv,
    translateImpl: () =>
      new Promise((resolve) => {
        setTimeout(
          () =>
            resolve({
              provider: "minimax",
              sourceLanguage: "en",
              targetLanguage: "zh-CN",
              text: "这条超时译文不应被缓存。",
            }),
          50,
        );
      }),
  });
  const recovered = await fetchExternalCatalystItems({
    stocks: ALPHA_RESEARCH_STOCKS.filter((stock) => stock.ticker === "NVDA"),
    env: {
      ...cacheEnv,
      STOCKS_NEWS_TRANSLATE_TIMEOUT_MS: "1000",
    },
    translateImpl: async () => ({
      provider: "minimax",
      sourceLanguage: "en",
      targetLanguage: "zh-CN",
      text: "NVDA 缓存翻译测试，云资本开支仍然强劲。",
    }),
  });
  assert.equal(recovered.items[0].translation, "NVDA 缓存翻译测试，云资本开支仍然强劲。");
  assert.equal(cacheFetchCalls, 2);
} finally {
  globalThis.fetch = originalFetch;
  rmSync(tempCachePath, { force: true });
}

const staleCachePath = join(
  process.cwd(),
  ".signal-hub",
  `stocks-news-stale-cache-test-${process.pid}.json`,
);
rmSync(staleCachePath, { force: true });
let staleFetchCalls = 0;
globalThis.fetch = async () => {
  staleFetchCalls += 1;
  if (staleFetchCalls === 1) {
    return new Response(
      `<?xml version="1.0"?><rss><channel><item><title>NVDA stale cache seed</title><link>https://finance.yahoo.com/news/nvda-stale-cache-seed</link><pubDate>Thu, 07 May 2026 01:30:00 GMT</pubDate><description>Seed item.</description></item></channel></rss>`,
      { status: 200 },
    );
  }
  return new Response("rate limit", { status: 429 });
};

try {
  const staleEnv = {
    STOCKS_NEWS_PROVIDER: "yahoo",
    STOCKS_NEWS_CACHE_PATH: staleCachePath,
    STOCKS_NEWS_CACHE_MS: "1",
    STOCKS_NEWS_STALE_CACHE_MS: "600000",
    STOCKS_INCLUDE_LOCAL_SIGNALS: "false",
    STOCKS_NEWS_TRANSLATE_ENABLED: "false",
    STOCKS_NEWS_ITEMS_PER_TICKER: "2",
    STOCKS_YAHOO_NEWS_MAX_TICKERS: "1",
  };
  await fetchExternalCatalystItems({
    stocks: ALPHA_RESEARCH_STOCKS.filter((stock) => stock.ticker === "NVDA"),
    env: staleEnv,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const staleRecovered = await fetchExternalCatalystItems({
    stocks: ALPHA_RESEARCH_STOCKS.filter((stock) => stock.ticker === "NVDA"),
    env: staleEnv,
  });
  assert.equal(staleRecovered.items[0].text.includes("NVDA stale cache seed"), true);
  assert.ok(staleRecovered.errors.some((error) => error.includes("stale")));
  assert.equal(staleFetchCalls, 2);
} finally {
  globalThis.fetch = originalFetch;
  rmSync(staleCachePath, { force: true });
}

const patreonHtml = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: {
    pageProps: {
      posts: [
        {
          id: "patreon-post-1",
          title: "NVDA inference demand update",
          url: "https://www.patreon.com/posts/patreon-post-1",
          published_at: "2026-05-12T12:00:00.000Z",
          excerpt: "NVDA demand remains strong in the latest checks.",
          content: "subscriber-only full post ".repeat(100),
        },
      ],
    },
  },
})}</script></html>`;
const patreonCalls = [];
const patreonSubscription = await fetchPatreonSubscriptionItems({
  stocks: ALPHA_RESEARCH_STOCKS.filter((stock) => stock.ticker === "NVDA"),
  fetchImpl: async (url, init) => {
    patreonCalls.push({
      url: String(url),
      cookie: init?.headers?.cookie ?? init?.headers?.Cookie ?? "",
    });
    return new Response(patreonHtml, { status: 200 });
  },
  env: {
    STOCKS_PATREON_ENABLED: "true",
    STOCKS_PATREON_URL: "https://www.patreon.com/c/bboczeng/posts",
    STOCKS_PATREON_COOKIE: "session_id=secret; patreon_device_id=device",
    STOCKS_PATREON_CACHE_MS: "0",
  },
});
assert.equal(patreonSubscription.items.length, 1);
assert.equal(patreonSubscription.items[0].source, "Patreon");
assert.equal(patreonSubscription.items[0].sourceRole, "subscription");
assert.ok(patreonCalls[0].url.includes("patreon.com/c/bboczeng/posts"));
assert.ok(patreonCalls[0].cookie.includes("session_id=secret"));
assert.ok(!patreonSubscription.items[0].text.includes("subscriber-only full post subscriber-only"));

const patreonOnlySnapshot = await getStocksCatalystSnapshot({
  stocks: ALPHA_RESEARCH_STOCKS.filter((stock) => stock.ticker === "NVDA"),
  fetchImpl: async (url, init) => {
    assert.ok(String(url).includes("patreon.com"));
    assert.ok(String(init?.headers?.cookie ?? "").includes("session_id=secret"));
    return new Response(patreonHtml, { status: 200 });
  },
  env: {
    STOCKS_NEWS_PROVIDER: "mock",
    STOCKS_INCLUDE_LOCAL_SIGNALS: "false",
    STOCKS_PATREON_ENABLED: "true",
    STOCKS_PATREON_URL: "https://www.patreon.com/c/bboczeng/posts",
    STOCKS_PATREON_COOKIE: "session_id=secret",
    STOCKS_PATREON_CACHE_MS: "0",
  },
});
assert.equal(patreonOnlySnapshot.source, "live");
assert.equal(patreonOnlySnapshot.provider, "subscription-research");
assert.equal(patreonOnlySnapshot.catalysts.NVDA[0].sourceRole, "subscription");

const translatedSnapshot = await getStocksCatalystSnapshot({
  stocks: ALPHA_RESEARCH_STOCKS.filter((stock) => stock.ticker === "NVDA"),
  fetchImpl,
  env: {
    STOCKS_NEWS_PROVIDER: "yahoo",
    STOCKS_INCLUDE_LOCAL_SIGNALS: "false",
    STOCKS_NEWS_TRANSLATE_ENABLED: "true",
  },
  translateImpl: async () => ({
    provider: "minimax",
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    text: "NVDA 供应商检查上修，云资本开支仍然强劲。",
  }),
});
assert.equal(
  translatedSnapshot.catalysts.NVDA[0].title,
  "NVDA 供应商检查上修，云资本开支仍然强劲。",
);

console.log("ok - stocks catalyst source");
