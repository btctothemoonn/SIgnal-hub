import assert from "node:assert/strict";
import { selectTelegramXSourceRows } from "./x-hybrid-telegram-scan.ts";

const keys = new Set(["xxxx6551monitor"]);
const rows = [
  {
    channel_ref: "news",
    channel_username: "news",
    channel_id: "1",
    channel_title: "News",
    message_id: 3,
  },
  {
    channel_ref: "another",
    channel_username: "another",
    channel_id: "2",
    channel_title: "Another",
    message_id: 2,
  },
  {
    channel_ref: "6551",
    channel_username: "xxxx6551monitor",
    channel_id: "3917604128",
    channel_title: "6551monitor",
    message_id: 1,
  },
];

assert.deepEqual(
  selectTelegramXSourceRows(rows, keys, 1).map((row) => row.message_id),
  [1],
);

console.log("ok - x hybrid telegram scan limits after source filtering");
