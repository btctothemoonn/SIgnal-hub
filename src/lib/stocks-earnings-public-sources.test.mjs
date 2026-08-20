import assert from "node:assert/strict";
import { getStocksEarningsSourceConfig } from "./stocks-earnings-source-config.ts";
import {
  clearStocksPublicEarningsCacheForTests,
  fetchPublicEarningsCandidates,
} from "./stocks-earnings-public-sources.ts";

const nvda = {
  ticker: "NVDA",
  companyName: "NVIDIA",
  companyNameZh: "英伟达",
  listing: { market: "US", exchange: "NASDAQ", currency: "USD" },
};

assert.equal(getStocksEarningsSourceConfig("NVDA").secCik, "0001045810");
assert.equal(getStocksEarningsSourceConfig("000660.KS").secCik, null);

const earningsLabsHtml = `
  <html><body>
    <table data-earnings-history>
      <thead><tr>
        <th>Quarter</th><th>Fiscal Date</th><th>Report Date</th>
        <th>Revenue Estimate</th><th>Revenue Actual</th>
        <th>EPS Estimate</th><th>EPS Actual</th>
      </tr></thead>
      <tbody><tr>
        <td>FY2027 Q1</td><td>2026-04-26</td><td>2026-05-20</td>
        <td>$78.42B</td><td>$81.61B</td><td>$0.89</td><td>$0.96</td>
      </tr></tbody>
    </table>
  </body></html>`;

const chartmillHtml = `
  <html><body>
    <section data-upcoming-earnings>
      <dl>
        <dt>Fiscal Quarter</dt><dd>FY2027 Q2</dd>
        <dt>Fiscal Date</dt><dd>2026-07-27</dd>
        <dt>Report Date</dt><dd>2026-08-26</dd>
        <dt>Revenue Consensus</dt><dd>$45.85B</dd>
        <dt>EPS Consensus</dt><dd>$1.01</dd>
      </dl>
    </section>
  </body></html>`;

const officialIrHtml = `
  <html><head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Event",
        "name": "NVIDIA FY2027 Q2 Financial Results",
        "startDate": "2026-08-26T14:00:00-07:00",
        "eventStatus": "https://schema.org/EventScheduled"
      }
    </script>
  </head><body data-report-timing="after-market">
    <p>Revenue is expected to be $45.0 billion, plus or minus 2%.</p>
  </body></html>`;

function fixtureFetch(url) {
  const value = String(url);
  if (value.includes("investor.nvidia.com")) {
    return Promise.resolve(new Response(officialIrHtml));
  }
  if (value.includes("earningslabs.com")) {
    return Promise.resolve(new Response(earningsLabsHtml));
  }
  if (value.includes("chartmill.com")) {
    return Promise.resolve(new Response(chartmillHtml));
  }
  throw new Error(`unexpected fixture URL: ${value}`);
}

clearStocksPublicEarningsCacheForTests();
const fixtureResult = await fetchPublicEarningsCandidates({
  stock: nvda,
  now: new Date("2026-08-15T00:00:00.000Z"),
  fetchImpl: fixtureFetch,
  env: {},
});

const q1 = fixtureResult.candidates.find(
  (candidate) => candidate.fiscalYear === 2027 && candidate.quarter === "Q1",
);
assert.ok(q1, "EarningsLabs historical row should produce FY2027 Q1");
assert.equal(q1.revenueEstimate, 78_420_000_000);
assert.equal(q1.revenueActual, 81_610_000_000);
assert.equal(q1.epsEstimate, 0.89);
assert.equal(q1.epsActual, 0.96);
assert.equal(q1.fieldSources.revenueEstimate.provider, "earnings-labs");

const q2Candidates = fixtureResult.candidates.filter(
  (candidate) => candidate.fiscalYear === 2027 && candidate.quarter === "Q2",
);
assert.ok(q2Candidates.length >= 2, JSON.stringify(fixtureResult));
assert.equal(
  q2Candidates.some(
    (candidate) =>
      candidate.reportDate === "2026-08-26" &&
      candidate.fieldSources.reportDate?.provider === "official-ir",
  ),
  true,
);
const q2Consensus = q2Candidates.find(
  (candidate) => candidate.fieldSources.revenueEstimate?.provider === "chartmill",
);
assert.ok(q2Consensus);
assert.equal(q2Consensus.revenueEstimate, 45_850_000_000);
assert.equal(q2Consensus.epsEstimate, 1.01);
assert.equal(q2Consensus.revenueActual, null);
assert.equal(q2Consensus.epsActual, null);
assert.equal(q2Consensus.reportTiming, "unknown");

const official = q2Candidates.find(
  (candidate) => candidate.fieldSources.reportDate?.provider === "official-ir",
);
assert.ok(official?.companyGuidance);
assert.equal(official.companyGuidance.revenueMid, 45_000_000_000);
assert.equal(official.companyGuidance.source.provider, "official-ir");

clearStocksPublicEarningsCacheForTests();
const failureResult = await fetchPublicEarningsCandidates({
  stock: nvda,
  now: new Date("2026-08-15T00:00:00.000Z"),
  fetchImpl: async (url) => {
    const value = String(url);
    if (value.includes("investor.nvidia.com")) {
      return new Response("<html><body>changed page</body></html>");
    }
    if (value.includes("earningslabs.com")) {
      return new Response("rate limited", { status: 429 });
    }
    return new Response("server error", { status: 500 });
  },
  env: {},
});
assert.deepEqual(failureResult.candidates, []);
assert.equal(failureResult.errors.some((error) => error.includes("schema mismatch")), true);
assert.equal(failureResult.errors.some((error) => error.includes("HTTP 429")), true);
assert.equal(failureResult.errors.some((error) => error.includes("HTTP 500")), true);
assert.equal(failureResult.errors.some((error) => error.includes("SEC skipped")), true);

clearStocksPublicEarningsCacheForTests();
const timeoutResult = await fetchPublicEarningsCandidates({
  stock: { ...nvda, ticker: "TIMEOUT" },
  now: new Date("2026-08-15T00:00:00.000Z"),
  fetchImpl: (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    }),
  env: { STOCKS_EARNINGS_FETCH_TIMEOUT_MS: "10" },
});
assert.equal(timeoutResult.errors.some((error) => error.includes("timeout")), true);

console.log("ok - stocks public earnings sources");
