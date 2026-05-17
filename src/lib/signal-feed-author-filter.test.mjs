import assert from "node:assert/strict";
import {
  ALL_SIGNAL_FEED_AUTHOR_FILTER,
  buildSignalFeedAuthorOptions,
  matchesSignalFeedAuthorFilter,
} from "./signal-feed-author-filter.ts";

const items = [
  {
    source: "telegram",
    title: "AU Trading Journal",
    subtitle: "@au_trading",
  },
  {
    source: "telegram",
    title: "AU Trading Journal",
    subtitle: "@au_trading",
  },
  {
    source: "monitor985",
    title: "AB Kuai.Dong",
    subtitle: "@_FORAB · 985monitor",
  },
  {
    source: "x",
    title: "AB Kuai.Dong",
    subtitle: "@_FORAB",
  },
  {
    source: "x",
    title: "Watcher.Guru",
    subtitle: "@WatcherGuru",
  },
];

const options = buildSignalFeedAuthorOptions(items);
assert.deepEqual(options, [
  {
    value: "x:_forab",
    label: "AB Kuai.Dong @_FORAB",
    count: 2,
  },
  {
    value: "telegram:au_trading",
    label: "AU Trading Journal @au_trading",
    count: 2,
  },
  {
    value: "x:watcherguru",
    label: "Watcher.Guru @WatcherGuru",
    count: 1,
  },
]);

assert.equal(matchesSignalFeedAuthorFilter(items[0], ALL_SIGNAL_FEED_AUTHOR_FILTER), true);
assert.equal(matchesSignalFeedAuthorFilter(items[0], "telegram:au_trading"), true);
assert.equal(matchesSignalFeedAuthorFilter(items[2], "x:_forab"), true);
assert.equal(matchesSignalFeedAuthorFilter(items[3], "x:_forab"), true);
assert.equal(matchesSignalFeedAuthorFilter(items[2], "x:watcherguru"), false);

console.log("ok - signal feed author filter options");
