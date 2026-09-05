import assert from "node:assert/strict";

const previousFetch = globalThis.fetch;
const previousRestBaseUrl = process.env.BINANCE_HYNIX_PREMIUM_REST_BASE_URL;
const previousDateNow = Date.now;
const requests = [];
const requestStartedAt = previousDateNow();
let currentTimeMs = requestStartedAt;
let failKlineRequests = false;

process.env.BINANCE_HYNIX_PREMIUM_REST_BASE_URL = "https://fapi.binance.test";
Date.now = () => currentTimeMs;
globalThis.fetch = async (url) => {
  requests.push(String(url));
  const parsedUrl = new URL(String(url));
  const symbol = parsedUrl.searchParams.get("symbol");
  const startTime = Number(parsedUrl.searchParams.get("startTime"));

  if (parsedUrl.pathname.endsWith("/premiumIndex")) {
    return Response.json({
      symbol,
      markPrice: symbol === "SKHYUSDT" ? "1.1" : "10",
      indexPrice: symbol === "SKHYUSDT" ? "1.1" : "10",
      time: startTime + 60_000,
    });
  }

  if (failKlineRequests) {
    return Response.json(
      { code: -1003, msg: "Too many requests" },
      { status: 429 },
    );
  }

  return Response.json([
    [
      startTime,
      symbol === "SKHYUSDT" ? "1" : "10",
      symbol === "SKHYUSDT" ? "1.1" : "10",
      symbol === "SKHYUSDT" ? "0.9" : "10",
      symbol === "SKHYUSDT" ? "1.1" : "10",
      "10",
      startTime + 60_000 - 1,
    ],
  ]);
};

try {
  const { GET } = await import("./route.ts");
  const response = await GET(
    new Request(
      "http://signal-hub.test/api/stocks-hynix-premium?interval=1m&startTime=1783958400000",
    ),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.interval, "1m");
  assert.equal(payload.points.length, 2);
  assert.equal(payload.latest.premiumPct, 10);
  assert.ok(
    requests
      .filter((url) => url.includes("/fapi/v1/klines"))
      .every((url) => url.includes("interval=1m")),
  );
  assert.ok(
    requests
      .filter((url) => url.includes("/fapi/v1/klines"))
      .every(
        (url) =>
          Number(new URL(url).searchParams.get("startTime")) >=
          requestStartedAt - 3 * 24 * 60 * 60 * 1000,
      ),
  );
  assert.ok(payload.websocket.url.includes("kline_1m"));

  const requestCountAfterFirstLoad = requests.length;
  const cachedResponse = await GET(
    new Request(
      "http://signal-hub.test/api/stocks-hynix-premium?interval=1m&startTime=1783958400000",
    ),
  );
  assert.equal(cachedResponse.status, 200);
  assert.equal(requests.length, requestCountAfterFirstLoad);

  failKlineRequests = true;
  currentTimeMs += 5 * 60 * 1000;
  const degradedResponse = await GET(
    new Request(
      "http://signal-hub.test/api/stocks-hynix-premium?interval=1m&startTime=1783958400000",
    ),
  );
  assert.equal(degradedResponse.status, 200);
  const degradedPayload = await degradedResponse.json();
  assert.equal(
    degradedPayload.points.length,
    payload.points.length,
    "a transient Binance failure must retain the last healthy chart",
  );
  assert.ok(degradedPayload.errors.some((message) => message.includes("HTTP 429")));
  failKlineRequests = false;

  const requestCountBeforeFiveMinuteLoad = requests.length;
  const fiveMinuteResponse = await GET(
    new Request(
      "http://signal-hub.test/api/stocks-hynix-premium?interval=5m&startTime=1783958400000",
    ),
  );
  assert.equal(fiveMinuteResponse.status, 200);
  const fiveMinutePayload = await fiveMinuteResponse.json();
  const { restoreBinanceHynixPremiumSnapshot } = await import("../../../lib/binance-hynix-premium-browser-cache.ts");
  const compactResponse = await GET(new Request("http://signal-hub.test/api/stocks-hynix-premium?compact=1"));
  const compactPayload = await compactResponse.json();
  assert.equal(compactPayload.interval, "5m", "the retired 1m option must not be the API default");
  assert.equal(compactPayload.v, 1);
  assert.deepEqual(restoreBinanceHynixPremiumSnapshot(compactPayload), fiveMinutePayload);
  assert.ok(JSON.stringify(compactPayload).length < JSON.stringify(fiveMinutePayload).length);
  const fiveMinuteKlineRequests = requests
    .slice(requestCountBeforeFiveMinuteLoad)
    .filter((url) => url.includes("/fapi/v1/klines"));
  assert.ok(fiveMinuteKlineRequests.length > 0);
  assert.ok(
    fiveMinuteKlineRequests.every(
      (url) =>
        Number(new URL(url).searchParams.get("startTime")) >=
        requestStartedAt - 5 * 24 * 60 * 60 * 1000,
    ),
  );

  const hourlyUrl =
    "http://signal-hub.test/api/stocks-hynix-premium?interval=1h&startTime=1783958400000";
  const hourlyResponse = await GET(new Request(hourlyUrl));
  assert.equal(hourlyResponse.status, 200);

  for (let index = 1; index <= 5; index += 1) {
    const rollingResponse = await GET(
      new Request(
        `http://signal-hub.test/api/stocks-hynix-premium?interval=1m&startTime=1783958400000&endTime=${1783958400000 + index * 60_000}`,
      ),
    );
    assert.equal(rollingResponse.status, 200);
  }

  const requestCountBeforeHourlyReload = requests.length;
  const cachedHourlyResponse = await GET(new Request(hourlyUrl));
  assert.equal(cachedHourlyResponse.status, 200);
  assert.equal(
    requests.length,
    requestCountBeforeHourlyReload,
    "rolling 1m cache entries must not evict the 1h history cache",
  );
} finally {
  Date.now = previousDateNow;
  globalThis.fetch = previousFetch;
  if (previousRestBaseUrl === undefined) {
    delete process.env.BINANCE_HYNIX_PREMIUM_REST_BASE_URL;
  } else {
    process.env.BINANCE_HYNIX_PREMIUM_REST_BASE_URL = previousRestBaseUrl;
  }
}

console.log("ok - Hynix compact transport defaults to 5m and preserves legacy explicit intervals");
