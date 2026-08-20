import assert from "node:assert/strict";
import {
  assessCalendarEarningsCompleteness,
  buildCalendarYearEarnings,
} from "./stocks-earnings-calendar.ts";

function metric(estimate, actual) {
  return {
    estimate,
    actual,
    previousYearActual: null,
    estimateYoYPct: null,
    actualYoYPct: null,
    surprise: actual !== null && estimate !== null ? actual - estimate : null,
    surprisePct: null,
  };
}

function item({
  fiscalYear,
  quarter,
  fiscalDateEnding,
  reportDate,
  status,
  revenueEstimate = 100,
  revenueActual = 110,
  netIncomeEstimate = 20,
  netIncomeActual = 22,
}) {
  return {
    ticker: "NVDA",
    fiscalYear,
    quarter,
    fiscalDateEnding,
    reportDate,
    reportTiming: "after-market",
    currency: "USD",
    accountingBasis: "US GAAP",
    provider: "fmp",
    generatedAt: "2026-08-15T00:00:00.000Z",
    revenue: metric(revenueEstimate, revenueActual),
    netIncome: metric(netIncomeEstimate, netIncomeActual),
    status,
    reportDateSource: {
      provider: "official-ir",
      url: "https://investor.nvidia.com/",
      fetchedAt: "2026-08-15T00:00:00.000Z",
      confidence: "official",
    },
    companyGuidance: null,
    completeness: {
      complete: false,
      missing: [],
      attemptedProviders: ["fmp", "official-ir"],
    },
  };
}

const q2Upcoming = item({
  fiscalYear: 2027,
  quarter: "Q2",
  fiscalDateEnding: "2026-07-27",
  reportDate: "2026-08-26",
  status: "upcoming",
  revenueActual: null,
  netIncomeActual: null,
});
const q1Reported = item({
  fiscalYear: 2027,
  quarter: "Q1",
  fiscalDateEnding: "2026-04-26",
  reportDate: "2026-05-20",
  status: "reported",
});
const q4Reported = item({
  fiscalYear: 2026,
  quarter: "Q4",
  fiscalDateEnding: "2026-01-25",
  reportDate: "2026-02-25",
  status: "reported",
});
const q3Reported = item({
  fiscalYear: 2026,
  quarter: "Q3",
  fiscalDateEnding: "2025-10-26",
  reportDate: "2026-01-03",
  status: "reported",
});
const priorYear = item({
  fiscalYear: 2026,
  quarter: "Q2",
  fiscalDateEnding: "2025-07-27",
  reportDate: "2025-08-27",
  status: "reported",
});

const visible = buildCalendarYearEarnings({
  now: new Date("2026-08-15T00:00:00Z"),
  comparisons: [q1Reported, priorYear, q3Reported, q2Upcoming, q4Reported],
});
assert.deepEqual(
  visible.map((entry) => `${entry.fiscalYear}-${entry.quarter}`),
  ["2027-Q2", "2027-Q1", "2026-Q4", "2026-Q3"],
);
assert.equal(visible[0].status, "upcoming");
assert.equal(visible.some((entry) => entry.reportDate?.startsWith("2025-")), false);

assert.equal(
  buildCalendarYearEarnings({
    now: new Date("2026-08-10T00:00:00Z"),
    comparisons: [q2Upcoming],
  }).length,
  0,
  "an upcoming report 16 days away must remain hidden",
);
assert.equal(
  buildCalendarYearEarnings({
    now: new Date("2026-08-11T00:00:00Z"),
    comparisons: [q2Upcoming],
  }).length,
  1,
  "an upcoming report exactly 15 days away must be visible",
);

const duplicateQ1 = {
  ...q1Reported,
  generatedAt: "2026-08-14T00:00:00.000Z",
};
assert.equal(
  buildCalendarYearEarnings({
    now: new Date("2026-08-15T00:00:00Z"),
    comparisons: [q1Reported, duplicateQ1],
  }).length,
  1,
  "the same ticker fiscal period must only appear once",
);

const reportedIncomplete = item({
  fiscalYear: 2027,
  quarter: "Q1",
  fiscalDateEnding: "2026-04-26",
  reportDate: "2026-05-20",
  status: "reported",
  revenueEstimate: null,
  netIncomeActual: null,
});
const reportedCompleteness = assessCalendarEarningsCompleteness(reportedIncomplete);
assert.equal(reportedCompleteness.complete, false);
assert.deepEqual(reportedCompleteness.missing, [
  "revenue-estimate",
  "net-income-actual",
]);
assert.deepEqual(reportedCompleteness.attemptedProviders, [
  "fmp",
  "official-ir",
]);

const upcomingCompleteness = assessCalendarEarningsCompleteness(q2Upcoming);
assert.equal(upcomingCompleteness.complete, true);
assert.deepEqual(upcomingCompleteness.missing, []);

const nextYearOnly = buildCalendarYearEarnings({
  now: new Date("2027-01-01T00:00:00Z"),
  comparisons: [
    q1Reported,
    item({
      fiscalYear: 2027,
      quarter: "Q4",
      fiscalDateEnding: "2026-10-25",
      reportDate: "2027-01-01",
      status: "reported",
    }),
  ],
});
assert.deepEqual(nextYearOnly.map((entry) => entry.reportDate), ["2027-01-01"]);

console.log("ok - stocks calendar-year earnings rules");
