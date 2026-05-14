import assert from "node:assert/strict";
import { splitStocksCatalystsForDisplay } from "./stocks-catalyst-display.ts";

const catalysts = [
  {
    title: "Paid NVDA deep dive",
    type: "industry-event",
    date: "05/14 09:00",
    impact: "neutral",
    summary: "Subscription-only research note.",
    source: "Patreon",
    sourceRole: "subscription",
    author: "bboczeng",
    link: "https://www.patreon.com/posts/nvda",
  },
  ...Array.from({ length: 6 }, (_, index) => ({
    title: `General catalyst ${index}`,
    type: "product",
    date: `05/14 0${index}:00`,
    impact: "positive",
    summary: `General catalyst ${index} summary.`,
    source: "Yahoo Finance",
    sourceRole: "external",
    author: "Yahoo Finance",
    link: `https://finance.yahoo.com/news/${index}`,
  })),
];

const split = splitStocksCatalystsForDisplay(catalysts, 5);

assert.equal(split.subscriptionReports.length, 1);
assert.equal(split.subscriptionReports[0].source, "Patreon");
assert.equal(split.visibleCatalysts.length, 5);
assert.equal(
  split.visibleCatalysts.some((catalyst) => catalyst.sourceRole === "subscription"),
  false,
);
assert.equal(split.hiddenCatalysts.length, 1);

console.log("ok - stocks catalyst display separates subscription reports");
