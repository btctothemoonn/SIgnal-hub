import assert from "node:assert/strict";
import { getXHybridEnrichmentMode } from "./x-hybrid-enrichment-mode.ts";

assert.equal(getXHybridEnrichmentMode({}), "telegram-only");
assert.equal(
  getXHybridEnrichmentMode({ X_HYBRID_API_ENRICH: "true" }),
  "account",
);
assert.equal(
  getXHybridEnrichmentMode({
    X_HYBRID_API_ENRICH: "false",
    X_HYBRID_ENRICH_MODE: "tweet-id",
  }),
  "tweet-id",
);
assert.equal(
  getXHybridEnrichmentMode({ X_HYBRID_ENRICH_MODE: "telegram-only" }),
  "telegram-only",
);
assert.equal(
  getXHybridEnrichmentMode({ X_HYBRID_ENRICH_MODE: "account" }),
  "account",
);

console.log("ok - x hybrid enrichment mode parses local settings");
