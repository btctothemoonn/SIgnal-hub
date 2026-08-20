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

const secCompanyFacts = {
  facts: {
    "us-gaap": {
      RevenueFromContractWithCustomerExcludingAssessedTax: {
        units: {
          USD: [
            {
              end: "2022-01-30",
              filed: "2022-03-18",
              fy: 2022,
              fp: "FY",
              form: "10-K",
              val: 26_914_000_000,
            },
          ],
        },
      },
      Revenues: {
        units: {
          USD: [
            {
              end: "2025-04-27",
              filed: "2026-05-20",
              fy: 2027,
              fp: "Q1",
              form: "10-Q",
              val: 44_062_000_000,
              frame: "CY2025Q1",
            },
            {
              end: "2026-04-26",
              filed: "2026-05-20",
              fy: 2027,
              fp: "Q1",
              form: "10-Q",
              val: 81_615_000_000,
              frame: "CY2026Q1",
            },
          ],
        },
      },
      NetIncomeLoss: {
        units: {
          USD: [
            {
              end: "2026-04-26",
              filed: "2026-05-20",
              fy: 2027,
              fp: "Q1",
              form: "10-Q",
              val: 58_321_000_000,
              frame: "CY2026Q1",
            },
          ],
        },
      },
      WeightedAverageNumberOfDilutedSharesOutstanding: {
        units: {
          shares: [
            {
              end: "2026-04-26",
              filed: "2026-05-20",
              fy: 2027,
              fp: "Q1",
              form: "10-Q",
              val: 24_391_000_000,
              frame: "CY2026Q1",
            },
          ],
        },
      },
    },
  },
};

const finnhubCalendar = {
  earningsCalendar: [
    {
      date: "2026-08-26",
      revenueEstimate: 93_634_391_959,
      revenueActual: null,
      epsEstimate: 2.1283,
      epsActual: null,
      hour: "amc",
      symbol: "NVDA",
    },
    {
      date: "2026-11-17",
      revenueEstimate: 105_666_899_459,
      revenueActual: null,
      epsEstimate: 2.4084,
      epsActual: null,
      hour: "amc",
      symbol: "NVDA",
    },
  ],
};

const alphaVantageEstimates = {
  symbol: "NVDA",
  estimates: [
    {
      date: "2026-04-30",
      horizon: "fiscal quarter",
      revenue_estimate_average: "79115709670.00",
      eps_estimate_average: "1.7738",
    },
    {
      date: "2026-07-31",
      horizon: "fiscal quarter",
      revenue_estimate_average: "91936931570.00",
      eps_estimate_average: "2.0838",
    },
  ],
};

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
const structuredResult = await fetchPublicEarningsCandidates({
  stock: nvda,
  now: new Date("2026-08-15T00:00:00.000Z"),
  fetchImpl: async (url) => {
    const value = String(url);
    if (value.includes("data.sec.gov")) return Response.json(secCompanyFacts);
    if (value.includes("finnhub.io")) return Response.json(finnhubCalendar);
    if (value.includes("alphavantage.co")) return Response.json(alphaVantageEstimates);
    return fixtureFetch(url);
  },
  env: {
    STOCKS_SEC_USER_AGENT: "SignalHub/1.0 test",
    STOCKS_FINNHUB_API_KEY: "test-key",
    STOCKS_ALPHA_VANTAGE_API_KEY: "alpha-key",
  },
});
const secQ1 = structuredResult.candidates.find(
  (candidate) =>
    candidate.fiscalYear === 2027 &&
    candidate.quarter === "Q1" &&
    candidate.fieldSources.revenueActual?.provider === "sec",
);
assert.ok(secQ1, JSON.stringify(structuredResult));
assert.equal(secQ1.revenueActual, 81_615_000_000);
assert.equal(secQ1.netIncomeActual, 58_321_000_000);
assert.equal(secQ1.dilutedShares, 24_391_000_000);
const alphaQ1 = structuredResult.candidates.find(
  (candidate) =>
    candidate.fiscalYear === 2027 &&
    candidate.quarter === "Q1" &&
    candidate.fieldSources.revenueEstimate?.provider === "alpha-vantage",
);
assert.ok(alphaQ1, JSON.stringify(structuredResult));
assert.equal(alphaQ1.fiscalDateEnding, "2026-04-30");
assert.equal(alphaQ1.reportDate, "2026-05-20");
assert.equal(alphaQ1.revenueEstimate, 79_115_709_670);
assert.equal(alphaQ1.epsEstimate, 1.7738);
assert.equal(alphaQ1.dilutedShares, 24_391_000_000);
assert.equal(alphaQ1.fieldSources.dilutedShares.provider, "sec");
assert.equal(
  structuredResult.candidates.some((candidate) => candidate.reportDate.startsWith("2022-")),
  false,
);
const finnhubQ2 = structuredResult.candidates.find(
  (candidate) =>
    candidate.fiscalYear === 2027 &&
    candidate.quarter === "Q2" &&
    candidate.fieldSources.revenueEstimate?.provider === "finnhub",
);
assert.ok(finnhubQ2, JSON.stringify(structuredResult));
assert.equal(finnhubQ2.reportDate, "2026-08-26");
assert.equal(finnhubQ2.revenueEstimate, 93_634_391_959);
assert.equal(finnhubQ2.epsEstimate, 2.1283);
assert.equal(finnhubQ2.dilutedShares, 24_391_000_000);
assert.equal(finnhubQ2.fieldSources.dilutedShares.provider, "sec");

clearStocksPublicEarningsCacheForTests();
let alphaRetryCalls = 0;
const transientAlphaResult = await fetchPublicEarningsCandidates({
  stock: nvda,
  now: new Date("2026-08-15T00:00:00.000Z"),
  fetchImpl: async (url) => {
    const value = String(url);
    if (value.includes("investor.nvidia.com")) return new Response(officialIrHtml);
    if (value.includes("data.sec.gov")) return Response.json(secCompanyFacts);
    if (value.includes("alphavantage.co")) {
      alphaRetryCalls += 1;
      return Response.json(alphaVantageEstimates);
    }
    if (value.includes("earningslabs.com")) return new Response(earningsLabsHtml);
    if (value.includes("chartmill.com")) return new Response(chartmillHtml);
    throw new Error(`unexpected transient fixture URL: ${value}`);
  },
  env: {
    STOCKS_ALPHA_VANTAGE_API_KEY: "alpha-key",
    STOCKS_SEC_USER_AGENT: "SignalHub/1.0 test",
  },
  alphaVantageUnavailable: true,
});
assert.equal(alphaRetryCalls, 1);
assert.equal(
  transientAlphaResult.candidates.some(
    (candidate) =>
      candidate.quarter === "Q1" &&
      candidate.fieldSources.revenueEstimate?.provider === "alpha-vantage",
  ),
  true,
);

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
