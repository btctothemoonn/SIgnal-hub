import { createHash } from "node:crypto";
import type { MarketOpportunityMetrics } from "./market-opportunity-core.ts";
import type { DatabaseSync } from "node:sqlite";
import { MARKET_BRIEF_INTERVAL_MS, MARKET_BRIEF_STALE_AFTER_MS } from "./market-alert-brief-types.ts";
import type { MarketBriefItem, MarketBriefScope, MarketBriefSnapshot } from "./market-alert-brief-types.ts";

export { MARKET_BRIEF_INTERVAL_MS } from "./market-alert-brief-types.ts";
export type MarketBriefReports = Record<MarketBriefScope, MarketBriefSnapshot>;
type Row = Record<string, unknown>;
const number = (value: unknown) => Number(value) || 0;
const nullable = (value: unknown) => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const minutes = 60_000;

function trackItem(item: MarketBriefItem, row: Row | undefined, previous: MarketBriefItem | undefined, nowMs: number) {
  const alertAt = Date.parse(item.latestAt);
  if (!Number.isFinite(alertAt) || alertAt > nowMs || nowMs-alertAt > 120*minutes || !row || row.stale || row.error) return null;
  let metrics: MarketOpportunityMetrics;
  try { metrics = JSON.parse(String(row.metrics_json)); } catch { return null; }
  if (!metrics || metrics.symbol !== item.symbol || metrics.stale) return null;
  const observed = Date.parse(metrics.observedAt);
  const fetched = Date.parse(String(row.fetched_at));
  if (![observed,fetched].every(at => Number.isFinite(at) && at <= nowMs && nowMs-at <= 20*minutes)) return null;
  // The optional context comes only from complete candles, independently of
  // squeeze trigger values. Legacy caches retain their old impulse-only route.
  const context = metrics.watchlist;
  const closedAt = context ? Date.parse(context.candleClosedAt) : observed;
  if (!Number.isFinite(closedAt) || closedAt > nowMs || nowMs-closedAt > 20*minutes) return null;
  const squeeze = item.squeeze > 0;
  const fast = context ? context.pct5m : squeeze ? metrics.pct1m : metrics.pct5m;
  const slow = context ? context.pct15m : squeeze ? metrics.pct5m : metrics.pct15m;
  const volume = context ? context.volumeRatio5m : squeeze ? metrics.volumeRatio1m : metrics.volumeRatio5m;
  if (!finite(fast) || !finite(slow) || !finite(volume) || volume < 0) return null;
  const sign = item.direction === "down" ? -1 : 1;
  const distance = context && (sign > 0 ? context.distanceFromHighPct : context.distanceFromLowPct);
  // Both extremes certify complete high/low inputs. Missing support/breakout
  // prices must not turn an unavailable structure check into a healthy one.
  const intact = context && finite(context.distanceFromHighPct) && finite(context.distanceFromLowPct)
    && (sign > 0 ? !context.supportBreak && !context.lowerStructure : !context.breakout20);
  const sustained = Boolean(context && finite(context.pct1h) && sign*context.pct1h >= 3
    && finite(distance) && Math.abs(distance) <= 1.5 && intact
    && sign*slow >= -.5 && sign*fast > -.8 && volume > 0);
  const impulse = nowMs-alertAt <= 60*minutes && sign*slow >= .5 && sign*fast > -.5 && volume >= .8;
  if (!sustained && !impulse) return null;
  const mixed = item.pump > 0 && item.crash > 0;
  const aligned = sign*fast >= 0.5 && sign*slow >= 1 && volume >= 1.5 && !mixed;
  const trend = sustained ? sign > 0 ? "strong_up" : "strong_down" : "neutral";
  const confirmation = aligned ? "confirmed" : sustained && !mixed ? "consolidating" : "waiting";
  const momentumBand = sign*fast >= 3 ? 3 : sign*fast >= 1 ? 2 : sign*fast >= .5 ? 1 : 0;
  const volumeBand = volume >= 3 ? 3 : volume >= 2 ? 2 : volume >= 1.5 ? 1 : 0;
  const slowBand = sign*slow >= 3 ? 2 : sign*slow >= 1 ? 1 : 0;
  const bands = [momentumBand,volumeBand,slowBand,sustained ? 1 : 0];
  const strength = momentumBand + volumeBand + slowBand + (sustained ? 1 : 0);
  const previousTrack = previous?.tracking;
  const sameDirection = previous?.direction === item.direction;
  const notWeaker = previousTrack?.bands?.length === bands.length && bands.every((band,i) => band >= previousTrack.bands![i]);
  const improving = sameDirection && previousTrack && closedAt > Date.parse(previousTrack.observedAt) && notWeaker && strength > (previousTrack.strength ?? strength);
  const state = !aligned && !sustained ? "waiting" : !previousTrack || !sameDirection ? "new"
    : closedAt === Date.parse(previousTrack.observedAt) && previousTrack.trend === trend && previousTrack.confirmation === confirmation ? previousTrack.state
    : improving ? "strengthening" : sustained || notWeaker ? "continuing" : "waiting";
  const direction = sign > 0 ? "上涨" : "下跌";
  const periods = squeeze && !context ? "1m / 5m" : "5m / 15m";
  const signed = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  const shortEvidence = [
    `${periods} 涨跌 ${signed(fast)} / ${signed(slow)}${mixed ? "；窗口内涨跌预警反复" : ""}`,
    `${context ? "已收盘短周期" : squeeze ? "1m" : "缓存短周期"} 成交量比 ${volume.toFixed(2)} 倍${!squeeze && finite(metrics.oiGrowth15m) ? `；15m OI ${signed(metrics.oiGrowth15m)}` : ""}；${metrics.spotAvailable ? "有现货数据" : "缺少现货佐证"}`,
  ];
  const evidence = sustained && context && finite(context.pct1h) && finite(distance) ? [
    `已收盘 1h 涨跌 ${signed(context.pct1h)}；距近 24h ${sign > 0 ? "高" : "低"}点 ${Math.abs(distance).toFixed(2)}%`,
    `已收盘 ${periods} ${signed(fast)} / ${signed(slow)}；短周期量比 ${volume.toFixed(2)} 倍${finite(context.spotChange15m) ? `；现货 15m ${signed(context.spotChange15m)}` : "；缺少现货佐证"}${mixed ? "；预警方向反复" : ""}`,
  ] : shortEvidence;
  const nextWatch = `下轮观察 ${periods} 同向${direction}幅度是否分别达到或保持 0.5% / 1%，短周期量比是否达到或保持 1.5 倍${mixed ? "，且不再出现反向预警" : ""}。`;
  const trendDrop = `小时级同向幅度低于 3%、离近 24h ${sign > 0 ? "高" : "低"}点超过 1.5%、15m 反向超过 0.5%、5m 反向达到 0.8% 或${sign > 0 ? "跌破短期支撑 / 形成下行结构" : "向上突破近期高点"}，趋势降级并按短线条件重新筛选；量比无有效正值、行情数据超过 20 分钟或最新预警超过 120 分钟时移出。`;
  const dropIf = sustained ? trendDrop : `较长周期同向幅度低于 0.5%、短周期反向幅度达到 0.5%、量比低于 0.8 倍，或行情数据超过 20 分钟 / 最新预警超过 60 分钟时移出。`;
  const oiBand = !squeeze && finite(metrics.oiGrowth15m) ? metrics.oiGrowth15m >= 2 ? "up" : metrics.oiGrowth15m <= -2 ? "down" : "flat" : "unknown";
  // Reusable AI narration only sees these qualitative facts, never exact
  // measurements that can change while the material category stays unchanged.
  const narrativeFacts = [
    sustained ? sign > 0 ? "小时级保持强势，价格仍靠近近期高点，尚无结构破坏" : "小时级持续弱势，价格仍靠近近期低点，尚无向上突破" : "尚未满足小时级持续趋势条件",
    confirmation === "confirmed" ? "短线量价已确认" : confirmation === "consolidating" ? "短线整理或量能暂未确认，不据此否定仍完整的小时趋势" : "短线尚待确认",
    sign*fast >= .5 ? "短周期价格延续预警方向" : sign*fast > 0 ? "短周期同向幅度偏弱" : sign*fast < 0 ? "短周期已有小幅反向" : "短周期价格暂未变化",
    sign*slow >= 1 ? "较长周期仍有同向动量" : "较长周期同向幅度偏弱",
    volume >= 1.5 ? "量能配合价格变化" : volume >= 1 ? "量能接近基准，尚未放量确认" : "量能低于基准，尚未确认",
    mixed ? "预警方向反复" : "窗口内未出现相反方向的波动预警",
    oiBand === "up" ? "未平仓合约增加，但不能推断主力方向" : oiBand === "down" ? "未平仓合约减少，但不能单独判断资金方向" : oiBand === "flat" ? "未平仓合约变化不明显" : "缺少可用的持仓变化依据",
    context && finite(context.spotChange15m) ? sign*context.spotChange15m >= .1 ? "现货短周期同向" : sign*context.spotChange15m <= -.1 ? "现货短周期反向" : "现货短周期变化不明显" : !context && metrics.spotAvailable ? "有现货数据，但不据此推断现货同向" : "缺少现货佐证",
  ];
  const tracking: NonNullable<MarketBriefItem["tracking"]> = {
    state,trend,confirmation,expiresAt:new Date(Math.min(observed+20*minutes,fetched+20*minutes,closedAt+20*minutes,alertAt+(sustained ? 120 : 60)*minutes)).toISOString(),
    observedAt:new Date(closedAt).toISOString(),evidence,nextWatch,dropIf,strength,bands,narrativeFacts,
    signalKey:JSON.stringify([item.direction,state,trend,confirmation,momentumBand,volumeBand,slowBand,aligned,mixed,oiBand,Boolean(metrics.spotAvailable),squeeze,narrativeFacts]),
  };
  const reason = sustained ? `小时级保持${sign > 0 ? "强势" : "弱势"}，${aligned ? "短线量价同向确认，继续观察延续性" : mixed ? "短线预警反复，等待方向重新一致" : "短线整理，等待量价确认"}。`
    : aligned ? "短周期价格与成交量同向，值得继续观察延续性。" : mixed ? "方向出现反复，需等待量价重新一致。" : "仍有方向性变化，但短周期动量或量能尚未确认。";
  // Count is only a final tie-breaker, never the main qualification criterion.
  return { item:{...item,reason,tracking}, rank:(sustained ? 160 : 0)+(aligned ? 100 : 0)+strength*5+(nowMs-alertAt<=15*minutes ? 3 : 0)+(metrics.spotAvailable ? 1 : 0) };
}

export function createMarketBriefStore(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS market_alert_brief (
    id INTEGER PRIMARY KEY CHECK(id=1), next_check_ms INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT, fingerprint TEXT, reports_json TEXT, failed INTEGER NOT NULL DEFAULT 0
  ); INSERT OR IGNORE INTO market_alert_brief(id) VALUES(1);`);

  // Web and workers may start together during deployment. Serialize the schema
  // check as well as the migration so two processes cannot add the same column.
  db.exec("BEGIN IMMEDIATE");
  try {
    const columns = db.prepare("PRAGMA table_info(market_alert_brief)").all() as Row[];
    if (!columns.some(column => column.name === "schema_version")) db.exec("ALTER TABLE market_alert_brief ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1");
    db.prepare("UPDATE market_alert_brief SET next_check_ms=0,checked_at=NULL,schema_version=2 WHERE id=1 AND schema_version<2").run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  function getMarketBriefInput(nowMs = Date.now()): MarketBriefReports {
    const windowEnd = new Date(nowMs).toISOString();
    const reports = {} as MarketBriefReports;
    const previous = readMarketBriefCache(nowMs).reports["3h"];
    const enrichment = db.prepare("SELECT symbol,metrics_json,fetched_at,stale,error FROM market_opportunity_enrichment").all() as Row[];
    const bySymbol = new Map(enrichment.map(row => [String(row.symbol), row]));
    for (const scope of ["3h", "24h"] as const) {
      const windowStart = new Date(nowMs - (scope === "3h" ? 3 : 24) * 60 * 60_000).toISOString();
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
      let items: MarketBriefItem[] = rows.map(row => ({
        symbol: String(row.symbol), total:number(row.total), pump:number(row.pump), crash:number(row.crash), squeeze:number(row.squeeze),
        latestAt:String(row.latest_at), latestPrice:nullable(row.latest_price), latestChangePct:nullable(row.latest_change), maxLevel:number(row.max_level),
        direction: row.latest_type === "short_squeeze" ? "squeeze" : row.latest_side === "SHORT" ? "down" : "up",
        reason: number(row.pump) && number(row.crash) ? "涨跌预警均有触发，注意方向反复。" : number(row.squeeze) ? "出现轧空信号，等待后续价格确认。" : "同币预警已合并，关注最新触发方向。",
      }));
      let changes: MarketBriefSnapshot["changes"];
      if (scope === "3h") {
        const previousItems = previous?.items ?? [];
        items = items.map(item => trackItem(item,bySymbol.get(item.symbol),previousItems.find(old => old.symbol===item.symbol),nowMs))
          .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
          .sort((a,b) => b.rank-a.rank || Date.parse(b.item.latestAt)-Date.parse(a.item.latestAt) || b.item.total-a.item.total || a.item.symbol.localeCompare(b.item.symbol))
          .slice(0,3).map(candidate => candidate.item);
        changes = {
          added:items.filter(item => !previousItems.some(old => old.symbol===item.symbol)).map(item=>item.symbol),
          downgraded:previousItems.filter(old => !items.some(item=>item.symbol===old.symbol) || (old.tracking?.state!=="waiting" && items.find(item=>item.symbol===old.symbol)?.tracking?.state==="waiting")).map(item=>item.symbol),
        };
      } else items = items.slice(0,5);
      const mixed = rows.filter(row => number(row.pump) > 0 && number(row.crash) > 0).slice(0,3).map(row=>String(row.symbol));
      const old = items.filter(item=>nowMs-Date.parse(item.latestAt) > (scope === "3h" ? 30 : 120)*60_000).map(item=>item.symbol);
      reports[scope] = {
        scope,schemaVersion:2,changes,windowStart,windowEnd,generatedAt:null,checkedAt:windowEnd,model:null,status:items.length ? "pending" : "empty",stale:false,
        headline: scope === "3h" ? items.length ? `本轮筛出 ${items.length} 个跟踪候选，观察量价是否延续。` : "暂无证据充分且新鲜的跟踪候选。" : totals.total ? "过去 24 小时预警回顾，触发次数不代表当前强度。" : "本时间段暂无异动预警。",totals,items,
        risks:[...(scope === "3h" ? ["仅覆盖已缓存的候选；OI 变化不等于主力方向，轧空预警不等于已经轧空。"] : []),...(mixed.length ? [`${mixed.join("、")} 同时出现上涨与下跌预警，注意反复。`] : []),...(old.length ? [`${old.join("、")} 最近一次触发距今较久，不代表当前行情。`] : [])],
      };
    }
    return reports;
  }
  function readMarketBriefCache(nowMs = Date.now()) {
    const row = db.prepare("SELECT * FROM market_alert_brief WHERE id=1").get() as Row;
    const reports: Partial<MarketBriefReports> = {};
    try {
      const cached = JSON.parse(String(row.reports_json || "{}"));
      // Keep compatible caches, but never relabel a legacy one-hour report as three hours.
      for (const scope of ["3h", "24h"] as const) {
        if (cached?.[scope]?.scope === scope && (scope === "24h" || cached[scope].schemaVersion === 2)) reports[scope] = cached[scope];
      }
    } catch { /* Preserve the feed if a cache file was damaged. */ }
    for (const report of Object.values(reports)) {
      report.stale = !report.checkedAt || !Number.isFinite(Date.parse(report.checkedAt)) || nowMs-Date.parse(report.checkedAt) > MARKET_BRIEF_STALE_AFTER_MS;
    }
    const checkedAtMs = Date.parse(String(row.checked_at || ""));
    const nextCheckAt = Math.max(number(row.next_check_ms), Number.isFinite(checkedAtMs) ? checkedAtMs + MARKET_BRIEF_INTERVAL_MS : 0);
    return { reports, fingerprint: String(row.fingerprint || ""), nextCheckAt };
  }
  function claimMarketBriefCheck(nowMs: number) {
    // Persist the shared cadence across restarts and concurrent workers.
    return db.prepare("UPDATE market_alert_brief SET next_check_ms=?, checked_at=? WHERE id=1 AND next_check_ms<=? AND (checked_at IS NULL OR checked_at<=?)")
      .run(nowMs+MARKET_BRIEF_INTERVAL_MS,new Date(nowMs).toISOString(),nowMs,new Date(nowMs-MARKET_BRIEF_INTERVAL_MS).toISOString()).changes === 1;
  }
  function saveMarketBriefCache(reports: MarketBriefReports, fingerprint: string, nowMs: number, failed = false) {
    return db.prepare("UPDATE market_alert_brief SET reports_json=?, fingerprint=?, failed=? WHERE id=1 AND checked_at=?")
      .run(JSON.stringify(reports),fingerprint,Number(failed),new Date(nowMs).toISOString()).changes === 1;
  }
  return {getMarketBriefInput,readMarketBriefCache,claimMarketBriefCheck,saveMarketBriefCache};
}

export function marketBriefReportFingerprint(report: MarketBriefSnapshot) {
  const relevant = report.scope === "3h"
    ? {scope:report.scope,version:2,items:report.items.map(item=>({symbol:item.symbol,signalKey:item.tracking?.signalKey}))}
    : {scope:report.scope,totals:report.totals,items:report.items.map(({symbol,pump,crash,squeeze,total,direction,maxLevel})=>({symbol,pump,crash,squeeze,total,direction,maxLevel}))};
  return createHash("sha256").update(JSON.stringify(relevant)).digest("hex");
}

export function marketBriefFingerprint(reports: MarketBriefReports) {
  return createHash("sha256").update(JSON.stringify(Object.values(reports).map(marketBriefReportFingerprint))).digest("hex");
}
