import { MARKET_OPPORTUNITY_RULES } from "./market-opportunity-config.ts";

export type MarketOpportunityModel =
  | "capital_long"
  | "distribution_short"
  | "short_squeeze";

export type MarketOpportunityStage =
  | "疑似资金推动"
  | "拉盘做多确认"
  | "疑似高位派发"
  | "做空结构确认"
  | "轧空蓄势"
  | "轧空启动"
  | "杠杆拉盘，谨防回撤";

export type MarketOpportunityAction =
  | "关注做多"
  | "关注做空"
  | "等待确认"
  | "禁止追单";

export type MarketOpportunityMetrics = {
  symbol: string;
  observedAt: string;
  stale: boolean;
  pct1m: number | null;
  pct5m: number | null;
  pct15m: number | null;
  pct1h: number | null;
  pct24h: number | null;
  volumeRatio1m: number | null;
  volumeRatio5m: number | null;
  oiGrowth15m: number | null;
  oiNotional: number | null;
  funding: number | null;
  basis: number | null;
  globalLongShortRatio: number | null;
  topTraderLongShortRatio: number | null;
  takerBuySellRatio: number | null;
  spotAvailable: boolean;
  spotChange15m: number | null;
  spotVolumeRatio5m: number | null;
  perpSpotDivergencePct: number | null;
  distanceFromHighPct: number | null;
  distanceFromLowPct: number | null;
  priorRunUpPct: number | null;
  supportBreak: boolean;
  lowerStructure: boolean;
  breakout20: boolean;
  quoteVolume: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  alertCounts: {
    pump: number;
    crash: number;
    squeeze: number;
    total: number;
  };
};

export type MarketOpportunityDecision = {
  symbol: string;
  model: MarketOpportunityModel;
  direction: "LONG" | "SHORT";
  stage: MarketOpportunityStage;
  decision: MarketOpportunityAction;
  score: number;
  confidence: number;
  evidence: string[];
  confirmations: string[];
  invalidations: string[];
  risks: string[];
  mandatoryComplete: boolean;
  hardInvalidated: boolean;
  dataCoverage: number;
  metrics: MarketOpportunityMetrics;
  observedAt: string;
  expiresAt: string;
};

function finite(value: number | null) {
  return value !== null && Number.isFinite(value);
}

function value(value: number | null, fallback = 0) {
  return finite(value) ? Number(value) : fallback;
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function dataCoverage(metrics: MarketOpportunityMetrics) {
  const fields = [
    metrics.pct1m,
    metrics.pct5m,
    metrics.pct15m,
    metrics.pct1h,
    metrics.volumeRatio5m,
    metrics.oiGrowth15m,
    metrics.oiNotional,
    metrics.funding,
    metrics.basis,
    metrics.globalLongShortRatio,
    metrics.topTraderLongShortRatio,
    metrics.takerBuySellRatio,
    metrics.distanceFromHighPct,
    metrics.priorRunUpPct,
  ];
  if (metrics.spotAvailable) {
    fields.push(metrics.spotChange15m, metrics.spotVolumeRatio5m);
  }
  return Math.round((fields.filter(finite).length / fields.length) * 100);
}

function finishDecision(
  metrics: MarketOpportunityMetrics,
  decision: Omit<
    MarketOpportunityDecision,
    "symbol" | "score" | "confidence" | "dataCoverage" | "metrics" | "observedAt" | "expiresAt"
  > & { score: number },
): MarketOpportunityDecision {
  const coverage = dataCoverage(metrics);
  const score = clampScore(decision.score);
  const observedMs = Date.parse(metrics.observedAt);
  const safeObservedMs = Number.isFinite(observedMs) ? observedMs : Date.now();
  return {
    ...decision,
    symbol: metrics.symbol.toUpperCase(),
    score,
    confidence: Math.min(score, coverage),
    evidence: unique(decision.evidence).slice(0, 8),
    confirmations: unique(decision.confirmations).slice(0, 5),
    invalidations: unique(decision.invalidations).slice(0, 4),
    risks: unique(decision.risks).slice(0, 5),
    dataCoverage: coverage,
    metrics,
    observedAt: new Date(safeObservedMs).toISOString(),
    expiresAt: new Date(
      safeObservedMs + MARKET_OPPORTUNITY_RULES.maxLifetimeMs,
    ).toISOString(),
  };
}

function capIncomplete(score: number, mandatoryComplete: boolean) {
  return mandatoryComplete
    ? score
    : Math.min(score, MARKET_OPPORTUNITY_RULES.actionableScore - 1);
}

export function scoreCapitalDrivenLong(
  metrics: MarketOpportunityMetrics,
): MarketOpportunityDecision {
  const rules = MARKET_OPPORTUNITY_RULES.capitalLong;
  const evidence: string[] = [];
  const confirmations: string[] = [];
  const invalidations = ["5m 跌破启动结构且主动卖盘持续", "OI 与价格同步转弱"];
  const risks: string[] = [];
  let score = 0;

  if (value(metrics.pct5m) >= 2) {
    score += rules.pct5m;
    evidence.push("5m 动量转强");
  } else confirmations.push("等待 5m 动量重新转强");
  if (value(metrics.pct15m) >= 4) {
    score += rules.pct15m;
    evidence.push("15m 延续上涨");
  } else confirmations.push("等待 15m 趋势延续");
  if (value(metrics.pct1h) >= 7) {
    score += rules.pct1h;
    evidence.push("1h 结构同向");
  }
  if (value(metrics.volumeRatio5m) >= 2) {
    score += rules.volume;
    evidence.push("5m 成交显著放大");
  } else confirmations.push("等待成交量放大至常态 1.5 倍以上");
  if (value(metrics.oiGrowth15m) >= 4) {
    score += rules.openInterest;
    evidence.push("OI 随价格扩张");
  } else confirmations.push("等待 OI 随价格同步增加");
  if (value(metrics.takerBuySellRatio) >= 1.15) {
    score += rules.taker;
    evidence.push("主动买盘占优");
  } else confirmations.push("等待主动买盘占优");

  const spotConfirmed = !metrics.spotAvailable || (
    finite(metrics.spotChange15m) &&
    value(metrics.spotChange15m) >= Math.max(1, value(metrics.pct15m) * 0.5)
  );
  if (spotConfirmed) {
    score += rules.spot;
    evidence.push(metrics.spotAvailable ? "现货同步上涨" : "该合约无匹配现货市场");
  } else {
    confirmations.push("等待现货跟随，排除永续合约单边拉升");
    risks.push("永续强于现货");
  }
  if (metrics.alertCounts.pump >= 2) {
    score += rules.repeatedAlerts;
    evidence.push("两次以上上涨异动确认");
  }
  if (metrics.breakout20) {
    score += rules.breakout;
    evidence.push("突破短线结构高点");
  }

  const critical = [
    metrics.pct5m,
    metrics.pct15m,
    metrics.pct1h,
    metrics.volumeRatio5m,
    metrics.oiGrowth15m,
    metrics.funding,
    metrics.takerBuySellRatio,
  ];
  const mandatoryComplete = critical.every(finite);
  if (!finite(metrics.oiGrowth15m)) confirmations.push("等待 OI 数据恢复");
  if (!finite(metrics.funding)) confirmations.push("等待资金费率数据恢复");
  if (!finite(metrics.takerBuySellRatio)) confirmations.push("等待主动买卖比数据恢复");

  const chaseFlags = [
    value(metrics.funding) >= 0.0015,
    value(metrics.perpSpotDivergencePct) >= 3,
    value(metrics.pct15m) >= 15 || value(metrics.pct1h) >= 35,
  ];
  const chaseRisk = chaseFlags.filter(Boolean).length >= 2;
  if (value(metrics.funding) >= 0.0015) risks.push("资金费率过高");
  if (value(metrics.perpSpotDivergencePct) >= 3) risks.push("永续相对现货溢价过大");
  if (value(metrics.pct15m) >= 15 || value(metrics.pct1h) >= 35) risks.push("短线涨幅过大");

  const hardInvalidated =
    metrics.supportBreak &&
    value(metrics.pct5m) <= -4 &&
    value(metrics.takerBuySellRatio, 1) < 0.85;
  if (metrics.stale) risks.push("补充数据已过期，禁止新增确认");

  score = capIncomplete(score, mandatoryComplete);
  const actionable =
    score >= MARKET_OPPORTUNITY_RULES.actionableScore &&
    mandatoryComplete &&
    spotConfirmed &&
    value(metrics.oiGrowth15m) >= 2 &&
    value(metrics.takerBuySellRatio) >= 1.1 &&
    value(metrics.volumeRatio5m) >= 1.5 &&
    !metrics.stale &&
    !hardInvalidated;

  return finishDecision(metrics, {
    model: "capital_long",
    direction: "LONG",
    stage: chaseRisk
      ? "杠杆拉盘，谨防回撤"
      : actionable
        ? "拉盘做多确认"
        : "疑似资金推动",
    decision: hardInvalidated || metrics.stale
      ? "等待确认"
      : chaseRisk
        ? "禁止追单"
        : actionable
          ? "关注做多"
          : "等待确认",
    score,
    evidence,
    confirmations,
    invalidations,
    risks,
    mandatoryComplete,
    hardInvalidated,
  });
}

export function scoreDistributionShort(
  metrics: MarketOpportunityMetrics,
): MarketOpportunityDecision {
  const rules = MARKET_OPPORTUNITY_RULES.distributionShort;
  const evidence: string[] = [];
  const confirmations: string[] = [];
  const invalidations = ["重新突破近期高点", "主动买盘恢复并伴随 OI 扩张"];
  const risks: string[] = [];
  let score = 0;

  if (value(metrics.priorRunUpPct) >= 20) {
    score += rules.priorRunUp;
    evidence.push("此前已有明显拉升");
  } else confirmations.push("缺少高位派发所需的前置涨幅");
  if (value(metrics.distanceFromHighPct) <= -5) {
    score += rules.highFailure;
    evidence.push("冲高后明显回落");
  }
  if (value(metrics.pct5m) <= -2) {
    score += rules.pct5m;
    evidence.push("5m 动量转弱");
  }
  if (value(metrics.pct15m) <= -3) {
    score += rules.pct15m;
    evidence.push("15m 下行延续");
  } else confirmations.push("等待 15m 下行结构确认");
  if (value(metrics.pct1h) < 0) {
    score += rules.pct1h;
    evidence.push("1h 结构转弱");
  }
  if (value(metrics.volumeRatio5m) >= 1.5) {
    score += rules.volume;
    evidence.push("回落过程成交放大");
  }
  if (value(metrics.takerBuySellRatio, 1) <= 0.85) {
    score += rules.taker;
    evidence.push("主动卖盘占优");
  } else confirmations.push("等待主动卖盘持续");
  if (metrics.lowerStructure) {
    score += rules.lowerStructure;
    evidence.push("形成更低的短线结构");
  } else confirmations.push("等待形成更低高点或更低低点");
  if (metrics.supportBreak) {
    score += rules.supportBreak;
    evidence.push("关键支撑已跌破");
  } else confirmations.push("等待关键支撑跌破");
  if (value(metrics.oiGrowth15m, -999) >= -1) {
    score += rules.openInterest;
    evidence.push("OI 稳定或增加，存在新空参与");
  } else risks.push("OI 快速收缩，可能只是旧仓出清");
  if (metrics.alertCounts.crash >= 1) {
    score += rules.repeatedAlerts;
    evidence.push("下跌异动已触发");
  }

  const critical = [
    metrics.pct5m,
    metrics.pct15m,
    metrics.volumeRatio5m,
    metrics.oiGrowth15m,
    metrics.funding,
    metrics.takerBuySellRatio,
    metrics.priorRunUpPct,
    metrics.distanceFromHighPct,
  ];
  const mandatoryComplete = critical.every(finite);
  if (!finite(metrics.oiGrowth15m)) confirmations.push("等待 OI 数据恢复");
  if (!finite(metrics.takerBuySellRatio)) confirmations.push("等待主动买卖比数据恢复");
  const hardInvalidated =
    metrics.breakout20 &&
    value(metrics.pct5m) > 2 &&
    value(metrics.pct15m) > 4 &&
    value(metrics.takerBuySellRatio) > 1.15;
  if (metrics.stale) risks.push("补充数据已过期，禁止新增确认");

  score = capIncomplete(score, mandatoryComplete);
  const actionable =
    score >= MARKET_OPPORTUNITY_RULES.actionableScore &&
    mandatoryComplete &&
    metrics.supportBreak &&
    metrics.lowerStructure &&
    value(metrics.takerBuySellRatio) <= 0.85 &&
    value(metrics.oiGrowth15m) >= -1 &&
    !metrics.stale &&
    !hardInvalidated;

  return finishDecision(metrics, {
    model: "distribution_short",
    direction: "SHORT",
    stage: actionable ? "做空结构确认" : "疑似高位派发",
    decision: actionable ? "关注做空" : "等待确认",
    score,
    evidence,
    confirmations,
    invalidations,
    risks,
    mandatoryComplete,
    hardInvalidated,
  });
}

export function scoreSqueezeLong(
  metrics: MarketOpportunityMetrics,
): MarketOpportunityDecision {
  const rules = MARKET_OPPORTUNITY_RULES.squeezeLong;
  const evidence: string[] = [];
  const confirmations: string[] = [];
  const invalidations = ["资金费率转正且 OI 回落", "价格跌破轧空启动区间"];
  const risks: string[] = [];
  let score = 0;

  if (value(metrics.funding, 1) <= -0.001) {
    score += rules.fundingExtreme;
    evidence.push("资金费率极端为负");
  } else if (value(metrics.funding, 1) <= -0.0005) {
    score += rules.funding;
    evidence.push("资金费率为负");
  } else confirmations.push("等待负资金费率形成");
  if (value(metrics.basis, 1) <= -0.001) {
    score += rules.basis;
    evidence.push("永续合约相对指数折价");
  }
  if (value(metrics.oiGrowth15m) >= 12) {
    score += rules.openInterestExtreme;
    evidence.push("OI 快速扩张");
  } else if (value(metrics.oiGrowth15m) >= 6) {
    score += rules.openInterest;
    evidence.push("OI 明显增加");
  } else if (value(metrics.oiGrowth15m) >= 4) {
    score += rules.openInterestSetup;
    evidence.push("OI 开始增加");
  } else confirmations.push("等待 OI 扩张");
  if (value(metrics.globalLongShortRatio, 9) <= 0.9) {
    score += rules.globalCrowding;
    evidence.push("全市场账户偏空");
  }
  if (value(metrics.topTraderLongShortRatio, 9) <= 0.9) {
    score += rules.topCrowding;
    evidence.push("大户仓位偏空");
  }
  if (value(metrics.takerBuySellRatio) >= 1.15) {
    score += rules.taker;
    evidence.push("主动买盘开始挤压空头");
  } else confirmations.push("等待主动买盘增强");
  if (value(metrics.volumeRatio5m) >= 2) {
    score += rules.volume;
    evidence.push("成交量同步放大");
  }
  if (metrics.breakout20) {
    score += rules.priceTrigger;
    evidence.push("价格突破短线高点");
  } else if (value(metrics.pct15m) >= 1.5) {
    score += 6;
    evidence.push("价格开始转强");
  } else confirmations.push("等待价格突破或 15m 转强");
  if (metrics.alertCounts.squeeze >= 1) {
    score += rules.repeatedAlerts;
    evidence.push("轧空监控已触发");
  }

  const critical = [
    metrics.funding,
    metrics.basis,
    metrics.oiGrowth15m,
    metrics.globalLongShortRatio,
    metrics.topTraderLongShortRatio,
    metrics.takerBuySellRatio,
  ];
  const mandatoryComplete = critical.every(finite);
  const setup =
    mandatoryComplete &&
    value(metrics.funding) <= -0.0005 &&
    value(metrics.oiGrowth15m) >= 4 &&
    value(metrics.globalLongShortRatio) <= 0.9 &&
    value(metrics.topTraderLongShortRatio) <= 0.9;
  const hardInvalidated =
    value(metrics.pct15m) <= -3 ||
    (finite(metrics.funding) && value(metrics.funding) > 0.0005);
  if (metrics.stale) risks.push("补充数据已过期，禁止新增确认");
  if (!mandatoryComplete) confirmations.push("等待费率、OI 与持仓比例数据完整");

  score = capIncomplete(score, mandatoryComplete);
  const actionable =
    setup &&
    score >= MARKET_OPPORTUNITY_RULES.actionableScore &&
    value(metrics.oiGrowth15m) >= 6 &&
    value(metrics.takerBuySellRatio) >= 1.15 &&
    (metrics.breakout20 || value(metrics.pct15m) >= 1.5) &&
    !metrics.stale &&
    !hardInvalidated;

  return finishDecision(metrics, {
    model: "short_squeeze",
    direction: "LONG",
    stage: actionable ? "轧空启动" : "轧空蓄势",
    decision: actionable ? "关注做多" : "等待确认",
    score,
    evidence,
    confirmations,
    invalidations,
    risks,
    mandatoryComplete,
    hardInvalidated,
  });
}

function decisionPriority(decision: MarketOpportunityDecision) {
  if (decision.decision === "关注做多" || decision.decision === "关注做空") return 3;
  if (decision.decision === "等待确认") return 2;
  return 1;
}

export function chooseMarketOpportunityDecision(
  decisions: MarketOpportunityDecision[],
) {
  return [...decisions]
    .filter((decision) => !decision.hardInvalidated)
    .sort((left, right) =>
      decisionPriority(right) - decisionPriority(left) ||
      right.score - left.score ||
      (right.model === "short_squeeze" ? 1 : 0) -
        (left.model === "short_squeeze" ? 1 : 0) ||
      left.model.localeCompare(right.model),
    )[0] ?? null;
}
