import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { MarketBriefItem, MarketBriefScope, MarketBriefSnapshot } from "./market-alert-brief-types.ts";

export const MARKET_BRIEF_INTERVAL_MS = 60 * 60_000;
export type MarketBriefReports = Record<MarketBriefScope, MarketBriefSnapshot>;
type Row = Record<string, unknown>;
const number = (value: unknown) => Number(value) || 0;
const nullable = (value: unknown) => value == null ? null : number(value);

export function createMarketBriefStore(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS market_alert_brief (
    id INTEGER PRIMARY KEY CHECK(id=1), next_check_ms INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT, fingerprint TEXT, reports_json TEXT, failed INTEGER NOT NULL DEFAULT 0
  ); INSERT OR IGNORE INTO market_alert_brief(id) VALUES(1);`);

  function getMarketBriefInput(nowMs = Date.now()): MarketBriefReports {
    const windowEnd = new Date(nowMs).toISOString();
    const reports = {} as MarketBriefReports;
    for (const scope of ["1h", "24h"] as const) {
      const windowStart = new Date(nowMs - (scope === "1h" ? 1 : 24) * MARKET_BRIEF_INTERVAL_MS).toISOString();
      // Aggregate the complete time window, independent of the UI's paginated feed.
      const rows = db.prepare(`WITH recent AS (
        SELECT *, ROW_NUMBER() OVER(PARTITION BY symbol ORDER BY occurred_at DESC, created_at DESC, id DESC) AS n
        FROM market_alert_events WHERE occurred_at>? AND occurred_at<=?
      ) SELECT symbol, COUNT(*) AS total,
        SUM(type='volatility' AND side='LONG') AS pump,
        SUM(type='volatility' AND side='SHORT') AS crash,
        SUM(type='short_squeeze') AS squeeze, MAX(level) AS max_level,
        MAX(CASE WHEN n=1 THEN occurred_at END) AS latest_at,
        MAX(CASE WHEN n=1 THEN price END) AS latest_price,
        MAX(CASE WHEN n=1 THEN change_pct END) AS latest_change,
        MAX(CASE WHEN n=1 THEN type END) AS latest_type,
        MAX(CASE WHEN n=1 THEN side END) AS latest_side
      FROM recent GROUP BY symbol ORDER BY total DESC, max_level DESC, latest_at DESC, symbol`).all(windowStart, windowEnd) as Row[];
      const totals = rows.reduce<MarketBriefSnapshot["totals"]>((sum, row) => ({ symbols: sum.symbols + 1, total: sum.total + number(row.total), pump: sum.pump + number(row.pump), crash: sum.crash + number(row.crash), squeeze: sum.squeeze + number(row.squeeze) }), {symbols:0,total:0,pump:0,crash:0,squeeze:0});
      const items: MarketBriefItem[] = rows.slice(0,5).map(row => ({
        symbol: String(row.symbol), total:number(row.total), pump:number(row.pump), crash:number(row.crash), squeeze:number(row.squeeze),
        latestAt:String(row.latest_at), latestPrice:nullable(row.latest_price), latestChangePct:nullable(row.latest_change), maxLevel:number(row.max_level),
        direction: row.latest_type === "short_squeeze" ? "squeeze" : row.latest_side === "SHORT" ? "down" : "up",
        reason: number(row.pump) && number(row.crash) ? "涨跌预警均有触发，注意方向反复。" : number(row.squeeze) ? "出现轧空信号，等待后续价格确认。" : "同币预警已合并，关注最新触发方向。",
      }));
      const mixed = rows.filter(row => number(row.pump) > 0 && number(row.crash) > 0).slice(0,3).map(row=>String(row.symbol));
      const old = items.filter(item=>nowMs-Date.parse(item.latestAt) > (scope === "1h" ? 30 : 120)*60_000).map(item=>item.symbol);
      reports[scope] = {
        scope,windowStart,windowEnd,generatedAt:null,checkedAt:windowEnd,model:null,status:totals.total ? "pending" : "empty",stale:false,
        headline: totals.total ? "预警统计已更新，AI 概况暂未生成。" : "本时间段暂无异动预警。",totals,items,
        risks:[...(mixed.length ? [`${mixed.join("、")} 同时出现上涨与下跌预警，注意反复。`] : []),...(old.length ? [`${old.join("、")} 最近一次触发距今较久，不代表当前行情。`] : [])],
      };
    }
    return reports;
  }
  function readMarketBriefCache(nowMs = Date.now()) {
    const row = db.prepare("SELECT * FROM market_alert_brief WHERE id=1").get() as Row;
    let reports: Partial<MarketBriefReports> = {};
    try { reports = JSON.parse(String(row.reports_json || "{}")); } catch { /* Preserve the feed if a cache file was damaged. */ }
    for (const report of Object.values(reports)) {
      report.stale = !!row.failed || !report.checkedAt || nowMs-Date.parse(report.checkedAt) > 75*60_000;
      if (row.failed) report.status = "error";
    }
    return { reports, fingerprint: String(row.fingerprint || ""), nextCheckAt: number(row.next_check_ms) };
  }
  function claimMarketBriefCheck(nowMs: number) {
    return db.prepare("UPDATE market_alert_brief SET next_check_ms=?, checked_at=? WHERE id=1 AND next_check_ms<=?")
      .run(nowMs+MARKET_BRIEF_INTERVAL_MS,new Date(nowMs).toISOString(),nowMs).changes === 1;
  }
  function saveMarketBriefCache(reports: MarketBriefReports, fingerprint: string, nowMs: number, failed = false) {
    return db.prepare("UPDATE market_alert_brief SET reports_json=?, fingerprint=?, failed=? WHERE id=1 AND checked_at=?")
      .run(JSON.stringify(reports),fingerprint,Number(failed),new Date(nowMs).toISOString()).changes === 1;
  }
  return {getMarketBriefInput,readMarketBriefCache,claimMarketBriefCheck,saveMarketBriefCache};
}

export function marketBriefFingerprint(reports: MarketBriefReports) {
  // Omit wall-clock timestamps; refreshing the page or unchanged inputs cost no tokens.
  return createHash("sha256").update(JSON.stringify(Object.values(reports).map(({scope,totals,items,risks})=>({scope,totals,items,risks})))).digest("hex");
}
