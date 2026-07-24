import type { AlphaResearchStock } from "./alpha-research-pool.ts";

export type StocksTodayChangeKind =
  | "catalyst"
  | "earnings"
  | "move"
  | "risk"
  | "data";

export type StocksTodayChangeTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "muted";

export type StocksTodayChange = {
  id: string;
  ticker: string;
  companyNameZh: string;
  kind: StocksTodayChangeKind;
  tone: StocksTodayChangeTone;
  score: number;
  title: string;
  detail: string;
  occurredAt?: string;
};

type BuildStocksTodayChangesOptions = {
  now?: Date;
  limit?: number;
  catalystWindowHours?: number;
};

function signedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function recentTimestamp(
  raw: string | undefined,
  now: Date,
  windowHours: number,
) {
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return null;
  const ageMs = now.getTime() - timestamp;
  if (ageMs < 0 || ageMs > windowHours * 60 * 60 * 1000) return null;
  return timestamp;
}

function catalystChange(
  stock: AlphaResearchStock,
  now: Date,
  windowHours: number,
): StocksTodayChange | null {
  const candidates = stock.catalysts
    .map((catalyst) => ({
      catalyst,
      timestamp: recentTimestamp(catalyst.createdAt, now, windowHours),
    }))
    .filter(
      (
        item,
      ): item is {
        catalyst: AlphaResearchStock["catalysts"][number];
        timestamp: number;
      } => item.timestamp !== null,
    )
    .sort((left, right) => right.timestamp - left.timestamp);
  const latest = candidates[0];
  if (!latest) return null;

  const roleScore =
    latest.catalyst.sourceRole === "subscription"
      ? 100
      : latest.catalyst.sourceRole === "external"
        ? 92
        : 86;
  const impactScore = latest.catalyst.impact === "neutral" ? 0 : 3;
  return {
    id: `${stock.ticker}:catalyst:${latest.catalyst.sourceItemId ?? latest.timestamp}`,
    ticker: stock.ticker,
    companyNameZh: stock.companyNameZh,
    kind: "catalyst",
    tone:
      latest.catalyst.impact === "positive"
        ? "success"
        : latest.catalyst.impact === "negative"
          ? "danger"
          : "info",
    score: roleScore + impactScore,
    title: latest.catalyst.title,
    detail: `${latest.catalyst.source ?? "消息"} · ${latest.catalyst.summary}`,
    occurredAt: latest.catalyst.createdAt,
  };
}

function earningsChange(stock: AlphaResearchStock): StocksTodayChange | null {
  if (stock.market.earningsStatus !== "upcoming") return null;
  return {
    id: `${stock.ticker}:earnings`,
    ticker: stock.ticker,
    companyNameZh: stock.companyNameZh,
    kind: "earnings",
    tone: "warning",
    score: 82,
    title: "财报窗口临近",
    detail: `${stock.financialSnapshot.nextEarningsDate || "日期待确认"} · ${stock.financialSnapshot.guidance || "等待预期数据"}`,
  };
}

function marketMoveChange(stock: AlphaResearchStock): StocksTodayChange | null {
  if (stock.market.source !== "live") {
    return {
      id: `${stock.ticker}:data`,
      ticker: stock.ticker,
      companyNameZh: stock.companyNameZh,
      kind: "data",
      tone: "muted",
      score: 40,
      title: "行情数据未确认",
      detail: "当前使用基线或回落数据，不参与强弱判断。",
    };
  }

  const dayMove = stock.market.dayChangePct;
  if (dayMove <= -4) {
    return {
      id: `${stock.ticker}:risk:day`,
      ticker: stock.ticker,
      companyNameZh: stock.companyNameZh,
      kind: "risk",
      tone: "danger",
      score: 70 + Math.min(15, Math.abs(dayMove)),
      title: `当日显著回撤 ${signedPercent(dayMove)}`,
      detail: `7日 ${signedPercent(stock.market.sevenDayChangePct)}，检查是否由财报、指引或行业消息触发。`,
    };
  }
  if (dayMove >= 4) {
    return {
      id: `${stock.ticker}:move:day`,
      ticker: stock.ticker,
      companyNameZh: stock.companyNameZh,
      kind: "move",
      tone: "success",
      score: 70 + Math.min(15, dayMove),
      title: `当日显著上涨 ${signedPercent(dayMove)}`,
      detail: `7日 ${signedPercent(stock.market.sevenDayChangePct)}，确认新催化与价格是否匹配。`,
    };
  }

  const sevenDayMove = stock.market.sevenDayChangePct;
  if (Math.abs(sevenDayMove) < 10) return null;
  const positive = sevenDayMove > 0;
  return {
    id: `${stock.ticker}:${positive ? "move" : "risk"}:7d`,
    ticker: stock.ticker,
    companyNameZh: stock.companyNameZh,
    kind: positive ? "move" : "risk",
    tone: positive ? "success" : "danger",
    score: 58 + Math.min(12, Math.abs(sevenDayMove) / 2),
    title: `7日趋势${positive ? "走强" : "转弱"} ${signedPercent(sevenDayMove)}`,
    detail: `今日 ${signedPercent(dayMove)}，关注趋势延续或均值回归风险。`,
  };
}

export function buildStocksTodayChanges(
  stocks: AlphaResearchStock[],
  {
    now = new Date(),
    limit = 8,
    catalystWindowHours = 24,
  }: BuildStocksTodayChangesOptions = {},
): StocksTodayChange[] {
  const changes = stocks
    .map((stock) => {
      const candidates = [
        catalystChange(stock, now, catalystWindowHours),
        earningsChange(stock),
        marketMoveChange(stock),
      ].filter((item): item is StocksTodayChange => Boolean(item));
      return candidates.sort((left, right) => right.score - left.score)[0] ?? null;
    })
    .filter((item): item is StocksTodayChange => Boolean(item))
    .sort(
      (left, right) =>
        right.score - left.score || left.ticker.localeCompare(right.ticker),
    );

  return changes.slice(0, Math.max(1, Math.min(20, Math.floor(limit))));
}
