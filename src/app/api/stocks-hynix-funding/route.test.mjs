import assert from "node:assert/strict";

const previousFetch = globalThis.fetch;
const previousRestBaseUrl = process.env.BINANCE_HYNIX_PREMIUM_REST_BASE_URL;
const fundingRequests = [];

process.env.BINANCE_HYNIX_PREMIUM_REST_BASE_URL = "https://fapi.binance.test";
globalThis.fetch = async (url) => {
  fundingRequests.push(String(url));
  const parsedUrl = new URL(String(url));
  return Response.json([
    {
      symbol: parsedUrl.searchParams.get("symbol"),
      fundingRate:
        parsedUrl.searchParams.get("symbol") === "SKHYUSDT"
          ? "-0.00100000"
          : "0.00020000",
      fundingTime: Date.parse("2026-07-14T00:00:00.000Z"),
      markPrice:
        parsedUrl.searchParams.get("symbol") === "SKHYUSDT" ? "130" : "1040",
    },
  ]);
};

try {
  const { GET } = await import("./route.ts");
  const response = await GET(
    new Request(
      "http://signal-hub.test/api/stocks-hynix-funding?startTime=1783958400000",
    ),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.source, "live");
  assert.equal(payload.records.length, 1);
  assert.equal(payload.records[0].combinedFundingRatePct, -0.12);
  assert.ok(
    fundingRequests.every((url) => url.includes("startTime=1783958400000")),
  );
} finally {
  globalThis.fetch = previousFetch;
  if (previousRestBaseUrl === undefined) {
    delete process.env.BINANCE_HYNIX_PREMIUM_REST_BASE_URL;
  } else {
    process.env.BINANCE_HYNIX_PREMIUM_REST_BASE_URL = previousRestBaseUrl;
  }
}

console.log("ok - stocks hynix funding route");
