import assert from "node:assert/strict";
import { extractTelegramButtonLinks } from "./telegram-message-buttons.ts";

assert.deepEqual(
  extractTelegramButtonLinks({
    rows: [
      {
        buttons: [
          { text: "View Details", url: "https://x.com/a/status/1" },
          { text: "No URL" },
        ],
      },
    ],
  }),
  [{ text: "View Details", url: "https://x.com/a/status/1" }],
);

console.log("ok - telegram message button links are extracted");
