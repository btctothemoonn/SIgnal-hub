import type { AlphaResearchStock } from "./alpha-research-pool.ts";

export type StocksTodayChangeTone = "positive" | "negative";

export type StocksTodayChange = {
  id: string;
  ticker: string;
  companyNameZh: string;
  tone: StocksTodayChangeTone;
  score: number;
  title: string;
  detail: string;
};

type BuildStocksTodayChangesOptions = {
  limit?: number;
};

function signedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function marketMoveChange(stock: AlphaResearchStock): StocksTodayChange | null {
  if (stock.market.source !== "live") return null;

  const dayMove = stock.market.dayChangePct;
  if (dayMove <= -4) {
    return {
      id: `${stock.ticker}:move:day`,
      ticker: stock.ticker,
      companyNameZh: stock.companyNameZh,
      tone: "negative",
      score: 70 + Math.min(15, Math.abs(dayMove)),
      title: `当日下跌 ${signedPercent(dayMove)}`,
      detail: `7日 ${signedPercent(stock.market.sevenDayChangePct)}，相对走弱。`,
    };
  }
  if (dayMove >= 4) {
    return {
      id: `${stock.ticker}:move:day`,
      ticker: stock.ticker,
      companyNameZh: stock.companyNameZh,
      tone: "positive",
      score: 70 + Math.min(15, dayMove),
      title: `当日上涨 ${signedPercent(dayMove)}`,
      detail: `7日 ${signedPercent(stock.market.sevenDayChangePct)}，相对走强。`,
    };
  }

  const sevenDayMove = stock.market.sevenDayChangePct;
  if (Math.abs(sevenDayMove) < 10) return null;
  const positive = sevenDayMove > 0;
  return {
    id: `${stock.ticker}:move:7d`,
    ticker: stock.ticker,
    companyNameZh: stock.companyNameZh,
    tone: positive ? "positive" : "negative",
    score: 58 + Math.min(12, Math.abs(sevenDayMove) / 2),
    title: `7日走势${positive ? "走强" : "走弱"} ${signedPercent(sevenDayMove)}`,
    detail: `今日 ${signedPercent(dayMove)}，关注趋势是否延续或均值回归。`,
  };
}

export function buildStocksTodayChanges(
  stocks: AlphaResearchStock[],
  { limit = 8 }: BuildStocksTodayChangesOptions = {},
): StocksTodayChange[] {
  return stocks
    .map(marketMoveChange)
    .filter((item): item is StocksTodayChange => Boolean(item))
    .sort(
      (left, right) =>
        right.score - left.score || left.ticker.localeCompare(right.ticker),
    )
    .slice(0, Math.max(1, Math.min(20, Math.floor(limit))));
}
