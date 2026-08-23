import type { DailyBriefItem } from "./daily-investment-brief";

export type DailyBriefGroupId = "ai" | "crypto" | "markets";

const AI_TOPIC_PATTERN = /AI|科技|半导体|芯片|存储|海力士|算力|机器人/i;
const CRYPTO_TOPIC_PATTERN = /BTC|比特币|加密|币圈|区块链|以太坊|ETH/i;

export function getDailyBriefGroup(
  item: Pick<DailyBriefItem, "topic">,
): DailyBriefGroupId {
  if (CRYPTO_TOPIC_PATTERN.test(item.topic)) return "crypto";
  if (AI_TOPIC_PATTERN.test(item.topic)) return "ai";
  return "markets";
}

export function groupDailyBriefItems<
  T extends Pick<DailyBriefItem, "topic">,
>(items: T[]): Record<DailyBriefGroupId, T[]> {
  const grouped: Record<DailyBriefGroupId, T[]> = {
    ai: [],
    crypto: [],
    markets: [],
  };
  for (const item of items) grouped[getDailyBriefGroup(item)].push(item);
  return grouped;
}
