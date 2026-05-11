import { DEFAULT_X_HYBRID_BACKFILL_LOOKBACK_HOURS } from "./x-hybrid-backfill-options.ts";

export type XHybridBackfillStatusInput = {
  lookbackHours?: number;
  checked: number;
  parsed: number;
  selected: number;
  enriched: number;
  failed: number;
  pointsReserved: number;
  quotedResolved: number;
  primaryRefreshes?: number;
  skippedAfter985Refresh?: number;
  skippedAlreadyProcessed?: number;
  skippedAlreadyIn985?: number;
  pendingGrace?: number;
  skippedNotConfigured?: number;
  skippedNoTweetId?: number;
};

function pluralPart(count: number | undefined, label: string) {
  return count && count > 0 ? `${count} 条${label}` : null;
}

export function formatXHybridBackfillStatus(input: XHybridBackfillStatusInput) {
  const lookbackHours =
    input.lookbackHours || DEFAULT_X_HYBRID_BACKFILL_LOOKBACK_HOURS;

  if (input.selected === 0) {
    const reasons = [
      pluralPart(input.skippedAlreadyProcessed, "此前已处理"),
      pluralPart(input.skippedAlreadyIn985, "985 已有"),
      pluralPart(input.pendingGrace, "仍在等待 985 窗口"),
      pluralPart(input.skippedNotConfigured, "不在关注列表"),
      pluralPart(input.skippedNoTweetId, "未识别 tweet id"),
    ].filter(Boolean);

    return (
      `6551 补漏完成：最近 ${lookbackHours} 小时检查 ${input.checked} 条，暂无需要调用 6551 的遗漏` +
      (reasons.length > 0 ? `；${reasons.join("，")}` : "") +
      `，消耗 ${input.pointsReserved} points`
    );
  }

  return (
    `6551 补漏完成：补入 ${input.enriched}/${input.selected} 条，消耗 ${input.pointsReserved} points` +
    ((input.primaryRefreshes || 0) > 0 ? "，985 已预刷新，不扣 points" : "") +
    ((input.skippedAfter985Refresh || 0) > 0
      ? `，985 已收进来 ${input.skippedAfter985Refresh} 条`
      : "") +
    (input.quotedResolved > 0 ? `，引用 ${input.quotedResolved} 条` : "") +
    (input.failed > 0 ? `，失败 ${input.failed} 条` : "")
  );
}
