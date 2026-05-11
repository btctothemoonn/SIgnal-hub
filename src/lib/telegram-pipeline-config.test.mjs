import assert from "node:assert/strict";
import { getTelegramPipelineConfig } from "./telegram-pipeline-config.ts";

const config = getTelegramPipelineConfig({
  TELEGRAM_PIPELINE_DB: "local.sqlite",
  TELEGRAM_PIPELINE_MEDIA_DIR: "media",
  TELEGRAM_PIPELINE_BACKFILL_INTERVAL_MS: "30000",
});

assert.equal(config.dbPath, "local.sqlite");
assert.equal(config.mediaDir, "media");
assert.equal(config.backfillIntervalMs, 30000);
assert.equal(config.messagesPerChannel, 80);
assert.equal(config.incrementalMessagesPerChannel, 300);
assert.equal(config.mediaPreviewItems, 24);
assert.equal(config.channelAvatarTtlMs, 604800000);

assert.equal(getTelegramPipelineConfig({}).backfillIntervalMs, 300000);

const proxyConfig = getTelegramPipelineConfig({
  TELEGRAM_PROXY_URL: "socks5://user:pass@127.0.0.1:7890",
});

assert.deepEqual(proxyConfig.proxy, {
  ip: "127.0.0.1",
  port: 7890,
  socksType: 5,
  username: "user",
  password: "pass",
  timeout: 8,
});

assert.equal(
  getTelegramPipelineConfig({
    TELEGRAM_PIPELINE_INCREMENTAL_MESSAGES_PER_CHANNEL: "500",
  }).incrementalMessagesPerChannel,
  500,
);

console.log("ok - telegram pipeline config parses local settings");
