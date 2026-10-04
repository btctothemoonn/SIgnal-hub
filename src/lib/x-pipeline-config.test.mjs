import assert from "node:assert/strict";
import {
  getXPipelineConfig,
  hasXPipelineDataSource,
  isXHybridEnabled,
  isMonitor985Enabled,
  isXPipelineEnabled,
} from "./x-pipeline-config.ts";

const config = getXPipelineConfig({
  X_PIPELINE_DB: "local-x.sqlite",
  X_PIPELINE_FEED_ITEMS: "80",
  X_PIPELINE_EVENT_POLL_MS: "1500",
  X_PIPELINE_MAX_RECONNECT_ATTEMPTS: "4",
  TWITTER_API_BASE: "https://example.test",
});

assert.equal(config.dbPath, "local-x.sqlite");
assert.equal(config.maxFeedItems, 80);
assert.equal(config.eventPollMs, 1500);
assert.equal(config.maxReconnectAttempts, 4);
assert.equal(config.baseUrl, "https://example.test");

const fallback = getXPipelineConfig({});
assert.equal(fallback.maxFeedItems, 200);
assert.equal(fallback.eventPollMs, 3000);
assert.equal(fallback.maxReconnectAttempts, 8);
assert.match(fallback.dbPath, /x-pipeline\.sqlite$/);

assert.equal(isMonitor985Enabled({ MONITOR985_ENABLED: "true" }), true);
assert.equal(isMonitor985Enabled({ MONITOR985_ENABLED: "0" }), false);
assert.equal(isXHybridEnabled({}), false);
assert.equal(isXHybridEnabled({ X_HYBRID_ENABLED: "false" }), false);
assert.equal(isXHybridEnabled({ X_HYBRID_ENABLED: "on" }), false);
assert.equal(isXHybridEnabled({ X_HYBRID_ENABLED: "on", TWITTER_CONNECTOR_ENABLED: "true" }), true);
assert.equal(isXPipelineEnabled({}), false);
assert.equal(isXPipelineEnabled({ TWITTER_CONNECTOR_ENABLED: "true" }), true);
assert.equal(hasXPipelineDataSource({ MONITOR985_ENABLED: "true" }), true);
assert.equal(hasXPipelineDataSource({ TWITTER_TOKEN: "token" }), false);
assert.equal(hasXPipelineDataSource({ TWITTER_TOKEN: "token", TWITTER_CONNECTOR_ENABLED: "true" }), true);
assert.equal(hasXPipelineDataSource({}), false);
assert.equal(hasXPipelineDataSource({ X_OWNED_READER_ENABLED: "true" }), true);
assert.equal(hasXPipelineDataSource({ X_OWNED_READER_ENABLED: "false" }), false);

console.log("ok - x pipeline config parses local settings");
