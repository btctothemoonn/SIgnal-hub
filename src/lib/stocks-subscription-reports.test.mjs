import assert from "node:assert/strict";
import { buildStocksSubscriptionReports } from "./stocks-subscription-reports.ts";

const stocks = [
  {
    ticker: "DRAM",
    catalysts: [
      {
        title: "Storage pricing cycle update",
        type: "supply-chain",
        date: "05/12 21:00",
        impact: "positive",
        summary: "NAND and SSD pricing checks improved.",
        source: "Patreon",
        sourceRole: "subscription",
        author: "bboczeng",
        link: "https://www.patreon.com/posts/storage-cycle",
      },
    ],
  },
  {
    ticker: "MU",
    catalysts: [
      {
        title: "Storage pricing cycle update",
        type: "supply-chain",
        date: "05/12 21:00",
        impact: "positive",
        summary: "NAND and SSD pricing checks improved.",
        source: "Patreon",
        sourceRole: "subscription",
        author: "bboczeng",
        link: "https://www.patreon.com/posts/storage-cycle",
      },
    ],
  },
  {
    ticker: "NVDA",
    catalysts: [
      {
        title: "External AI GPU update",
        type: "product",
        date: "05/12 20:00",
        impact: "neutral",
        summary: "External news should not show in subscription reports.",
        source: "Yahoo Finance",
        sourceRole: "external",
        author: "Yahoo",
        link: "https://finance.yahoo.com/news/nvda",
      },
    ],
  },
];

const reports = buildStocksSubscriptionReports(stocks);

assert.equal(reports.length, 1);
assert.equal(reports[0].title, "Storage pricing cycle update");
assert.deepEqual(reports[0].tickers, ["DRAM", "MU"]);
assert.equal(reports[0].source, "Patreon");
assert.equal(reports[0].author, "bboczeng");
assert.equal(reports[0].link, "https://www.patreon.com/posts/storage-cycle");

console.log("ok - stocks subscription reports");
