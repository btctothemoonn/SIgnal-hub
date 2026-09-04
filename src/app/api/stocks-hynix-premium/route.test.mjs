import assert from "node:assert/strict";

const previousFetch = globalThis.fetch;
const previousRestBaseUrl = process.env.BINANCE_HYNIX_PREMIUM_REST_BASE_URL;
const requests = [];
const requestStartedAt = Date.now();

process.env.BINANCE_HYNIX_PREMIUM_REST_BASE_URL = "https://fapi.binance.test";
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
      "http://signal-hub.test/api/stocks-hynix-premium?startTime=1783958400000",
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
      "http://signal-hub.test/api/stocks-hynix-premium?startTime=1783958400000",
    ),
  );
  assert.equal(cachedResponse.status, 200);
  assert.equal(requests.length, requestCountAfterFirstLoad);

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
  globalThis.fetch = previousFetch;
  if (previousRestBaseUrl === undefined) {
    delete process.env.BINANCE_HYNIX_PREMIUM_REST_BASE_URL;
  } else {
    process.env.BINANCE_HYNIX_PREMIUM_REST_BASE_URL = previousRestBaseUrl;
  }
}

console.log("ok - stocks hynix premium route defaults to 1m");
