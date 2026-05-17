import type {
  AlphaResearchCatalyst,
  AlphaResearchEarningsStatus,
  AlphaResearchStock,
} from "./alpha-research-pool";

export type StocksIntelligenceTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "muted";

export type StocksIntelligenceMetric = {
  label: string;
  value: string;
  note: string;
  tone: StocksIntelligenceTone;
};

export type StocksRiskTag = {
  label: string;
  tone: StocksIntelligenceTone;
  reason: string;
};

export type StocksEarningsBrief = {
  mode: "pre" | "post" | "watch" | "quiet";
  title: string;
  points: string[];
  confidence: "normal" | "limited";
};

export type StocksStructureSnapshot = {
  label: "强势" | "中性" | "偏弱" | "结构未确认";
  tone: StocksIntelligenceTone;
  score: number;
  points: string[];
};

export type StocksTickerContext = {
  price: StocksIntelligenceMetric;
  dayMove: StocksIntelligenceMetric;
  sevenDay: StocksIntelligenceMetric;
  earningsWindow: StocksIntelligenceMetric;
  revenue: StocksIntelligenceMetric;
  eps: StocksIntelligenceMetric;
  grossMargin: StocksIntelligenceMetric;
  freeCashFlow: StocksIntelligenceMetric;
  dataHealth: StocksIntelligenceMetric;
};

export type StocksIntelligence = {
  tickerContext: StocksTickerContext;
  earningsBrief: StocksEarningsBrief;
  riskTags: StocksRiskTag[];
  structure: StocksStructureSnapshot;
};

export type StocksSubscriptionInsightInput = Pick<
  AlphaResearchCatalyst,
  "title" | "summary" | "fullSummary" | "impact"
> & {
  tickers?: string[];
};

export type StocksSubscriptionInsight = {
  coreConclusion: string;
  impactLabel: "利多" | "利空" | "中性";
  relatedTickers: string[];
  impactChain: string;
  riskNote: string;
  fallbackUsed: boolean;
};

function formatSignedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function formatPrice(ticker: string, value: number) {
  if (ticker.endsWith(".KS")) {
    return new Intl.NumberFormat("ko-KR", {
      style: "currency",
      currency: "KRW",
      maximumFractionDigits: 0,
    }).format(value);
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function percentTone(value: number): StocksIntelligenceTone {
  if (value > 0) return "success";
  if (value < 0) return "danger";
  return "muted";
}

function normalizeTextValue(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || /^(n\/a|na|null|undefined|-|no forward estimate)$/i.test(trimmed)) {
    return "n/a";
  }
  return trimmed;
}

function hasUsableValue(value: string | undefined) {
  return normalizeTextValue(value) !== "n/a";
}

function earningsMode(status: AlphaResearchEarningsStatus): StocksEarningsBrief["mode"] {
  if (status === "upcoming") return "pre";
  if (status === "recent") return "post";
  if (status === "watch") return "watch";
  return "quiet";
}

function earningsStatusLabel(status: AlphaResearchEarningsStatus) {
  const labels: Record<AlphaResearchEarningsStatus, string> = {
    upcoming: "临近",
    recent: "刚披露",
    watch: "观察",
    quiet: "平静",
  };
  return labels[status];
}

function marketSourceLabel(stock: AlphaResearchStock) {
  if (stock.market.source !== "live") return "行情未确认";
  const provider = stock.market.provider?.toUpperCase() ?? "LIVE";
  const freshness = stock.market.freshness === "delayed" ? "延迟" : "实时";
  return `${provider} / ${freshness}`;
}

function latestCatalystByType(
  catalysts: AlphaResearchCatalyst[],
  type: AlphaResearchCatalyst["type"],
) {
  return catalysts.find((catalyst) => catalyst.type === type);
}

function buildTickerContext(stock: AlphaResearchStock): StocksTickerContext {
  const financial = stock.financialSnapshot;
  const financialSource =
    financial.source === "live"
      ? financial.periodLabel
        ? `live / ${financial.periodLabel}`
        : "live"
      : financial.source === "mock"
        ? "mock"
        : "baseline";
  const missingFinancials = [
    financial.revenue,
    financial.eps,
    financial.grossMargin,
    financial.freeCashFlow,
  ].filter((value) => !hasUsableValue(value)).length;
  const dataHealthValue =
    stock.market.source === "live" && missingFinancials === 0
      ? "可用"
      : stock.market.source === "live"
        ? "部分缺失"
        : "需核对";

  return {
    price: {
      label: "当前价格",
      value:
        stock.market.source === "live"
          ? formatPrice(stock.ticker, stock.market.lastPrice)
          : "n/a",
      note: marketSourceLabel(stock),
      tone: stock.market.source === "live" ? "info" : "muted",
    },
    dayMove: {
      label: "今日涨跌",
      value:
        stock.market.source === "live"
          ? formatSignedPercent(stock.market.dayChangePct)
          : "n/a",
      note: "盘中/当日价格反应",
      tone:
        stock.market.source === "live"
          ? percentTone(stock.market.dayChangePct)
          : "muted",
    },
    sevenDay: {
      label: "7日强弱",
      value:
        stock.market.candlesSource === "live"
          ? formatSignedPercent(stock.market.sevenDayChangePct)
          : "n/a",
      note:
        stock.market.candlesSource === "live"
          ? stock.market.relativeStrengthLabel
          : "K线未确认",
      tone:
        stock.market.candlesSource === "live"
          ? percentTone(stock.market.sevenDayChangePct)
          : "muted",
    },
    earningsWindow: {
      label: "财报窗口",
      value: earningsStatusLabel(stock.market.earningsStatus),
      note: normalizeTextValue(financial.nextEarningsDate),
      tone:
        stock.market.earningsStatus === "upcoming"
          ? "warning"
          : stock.market.earningsStatus === "recent"
            ? "info"
            : "muted",
    },
    revenue: {
      label: "营收",
      value: normalizeTextValue(financial.revenue),
      note: normalizeTextValue(financial.revenueYoY),
      tone: hasUsableValue(financial.revenue) ? "info" : "muted",
    },
    eps: {
      label: "EPS",
      value: normalizeTextValue(financial.eps),
      note: financialSource,
      tone: hasUsableValue(financial.eps) ? "info" : "muted",
    },
    grossMargin: {
      label: "毛利率",
      value: normalizeTextValue(financial.grossMargin),
      note: "利润率质量",
      tone: hasUsableValue(financial.grossMargin) ? "info" : "muted",
    },
    freeCashFlow: {
      label: "自由现金流",
      value: normalizeTextValue(financial.freeCashFlow),
      note: "现金转化",
      tone: hasUsableValue(financial.freeCashFlow) ? "info" : "muted",
    },
    dataHealth: {
      label: "数据健康",
      value: dataHealthValue,
      note:
        missingFinancials > 0
          ? `${missingFinancials} 项财务字段缺失`
          : `${marketSourceLabel(stock)} / ${financialSource}`,
      tone:
        dataHealthValue === "可用"
          ? "success"
          : dataHealthValue === "部分缺失"
            ? "warning"
            : "danger",
    },
  };
}

function buildEarningsBrief(stock: AlphaResearchStock): StocksEarningsBrief {
  const mode = earningsMode(stock.market.earningsStatus);
  const financial = stock.financialSnapshot;
  const guidance = normalizeTextValue(financial.guidance);
  const earningsCatalyst = latestCatalystByType(stock.catalysts, "earnings");
  const hasFinancialData =
    hasUsableValue(financial.revenue) || hasUsableValue(financial.eps);

  const points = [
    `窗口：${normalizeTextValue(financial.nextEarningsDate)}，当前状态为${earningsStatusLabel(
      stock.market.earningsStatus,
    )}。`,
    guidance !== "n/a"
      ? `指引/预期：${guidance}`
      : "指引/预期：暂未取得，不能硬判 EPS 或营收 beat/miss。",
    stock.market.source === "live"
      ? `价格反应：今日 ${formatSignedPercent(
          stock.market.dayChangePct,
        )}，7日 ${formatSignedPercent(stock.market.sevenDayChangePct)}。`
      : "价格反应：行情源未确认，先不做强弱判断。",
  ];

  if (earningsCatalyst) {
    points.push(`相关催化：${earningsCatalyst.title}`);
  }

  const titles: Record<StocksEarningsBrief["mode"], string> = {
    pre: "财报前：重点看预期、指引和价格是否提前反应",
    post: "财报后：重点复盘增长、利润率和指引变化",
    watch: "财报观察：等待管理层指引或关键业务更新",
    quiet: "非财报窗口：用价格和新闻确认主线是否延续",
  };

  return {
    mode,
    title: titles[mode],
    points,
    confidence: hasFinancialData ? "normal" : "limited",
  };
}

function buildRiskTags(stock: AlphaResearchStock): StocksRiskTag[] {
  const tags: StocksRiskTag[] = [];
  const financial = stock.financialSnapshot;

  if (
    stock.market.source !== "live" ||
    financial.source === "mock" ||
    !hasUsableValue(financial.revenue) ||
    !hasUsableValue(financial.eps)
  ) {
    tags.push({
      label: "数据不足",
      tone: "danger",
      reason: "行情或关键财务字段不是实时/可用数据。",
    });
  }

  if (stock.market.earningsStatus === "upcoming") {
    tags.push({
      label: "财报临近",
      tone: "warning",
      reason: "财报前价格和预期容易放大波动。",
    });
  } else if (stock.market.earningsStatus === "recent") {
    tags.push({
      label: "财报刚过",
      tone: "info",
      reason: "需要确认涨跌来自业绩、指引还是估值重定价。",
    });
  }

  if (stock.market.dayChangePct > 5 || stock.market.sevenDayChangePct > 12) {
    tags.push({
      label: "追高风险",
      tone: "warning",
      reason: "短线涨幅已经偏大，继续追入需要等待新催化确认。",
    });
  }

  if (
    stock.catalysts.some((catalyst) =>
      ["subscription", "external", "supplemental"].includes(
        catalyst.sourceRole ?? "",
      ),
    ) ||
    stock.catalysts.length > 0
  ) {
    tags.push({
      label: "消息驱动",
      tone: "info",
      reason: "当前判断包含新闻、订阅研报或补充信号。",
    });
  }

  if (stock.market.source === "live" && stock.market.candlesSource === "live") {
    if (stock.market.sevenDayChangePct >= 5 && stock.market.dayChangePct >= -1) {
      tags.push({
        label: "趋势偏强",
        tone: "success",
        reason: "7日表现强于普通观察阈值，且当日没有明显破坏。",
      });
    }
  }

  if (
    /-\d/.test(financial.revenueYoY) ||
    /^-/.test(financial.freeCashFlow.trim()) ||
    !hasUsableValue(financial.grossMargin)
  ) {
    tags.push({
      label: "估值/利润率风险",
      tone: "warning",
      reason: "增长、现金流或利润率质量需要进一步核对。",
    });
  }

  return tags;
}

function buildStructureSnapshot(stock: AlphaResearchStock): StocksStructureSnapshot {
  const points = [
    `今日 ${formatSignedPercent(stock.market.dayChangePct)}`,
    `7日 ${formatSignedPercent(stock.market.sevenDayChangePct)}`,
    stock.market.candlesSource === "live"
      ? `K线来源 ${stock.market.provider ?? "live"}`
      : "K线未确认",
  ];

  if (stock.market.source !== "live" || stock.market.candlesSource !== "live") {
    return {
      label: "结构未确认",
      tone: "muted",
      score: 0,
      points,
    };
  }

  const score =
    (stock.market.sevenDayChangePct >= 8 ? 45 : stock.market.sevenDayChangePct >= 3 ? 28 : 12) +
    (stock.market.dayChangePct >= 2 ? 25 : stock.market.dayChangePct >= -1 ? 15 : 4) +
    (stock.market.earningsStatus === "upcoming" ? 8 : 12);

  if (score >= 70) {
    return {
      label: "强势",
      tone: "success",
      score,
      points,
    };
  }

  if (stock.market.sevenDayChangePct <= -6 || stock.market.dayChangePct <= -4) {
    return {
      label: "偏弱",
      tone: "danger",
      score,
      points,
    };
  }

  return {
    label: "中性",
    tone: "info",
    score,
    points,
  };
}

export function buildStocksIntelligence(
  stock: AlphaResearchStock,
): StocksIntelligence {
  return {
    tickerContext: buildTickerContext(stock),
    earningsBrief: buildEarningsBrief(stock),
    riskTags: buildRiskTags(stock),
    structure: buildStructureSnapshot(stock),
  };
}

function compactText(value: string, maxLength = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function firstUsefulSentence(value: string) {
  const normalized = value.replace(/\r/g, "\n");
  const line =
    normalized
      .split(/\n|。|\.|；|;/)
      .map((item) => item.trim())
      .find(Boolean) ?? "";
  return line.replace(/^(核心观点|核心结论|结论|摘要)[:：]\s*/, "");
}

function inferImpactChain(text: string) {
  if (/DRAM|HBM|NAND|SSD|存储|内存|Memory/i.test(text)) {
    return "存储价格 / 库存 / 资本开支链条";
  }
  if (/NVDA|GPU|AI|算力|Blackwell|CUDA/i.test(text)) {
    return "AI 算力 / GPU / 数据中心链条";
  }
  if (/cloud|SaaS|Azure|AWS|OCI|软件|云/i.test(text)) {
    return "云服务 / SaaS / 企业软件链条";
  }
  if (/macro|利率|通胀|美元|原油|地缘|政策/i.test(text)) {
    return "宏观 / 政策 / 风险偏好链条";
  }
  return "产业新闻 / 个股估值链条";
}

function inferRiskNote(text: string, impact: StocksSubscriptionInsightInput["impact"]) {
  const riskMatch = text.match(/风险[:：]\s*([^。.\n]+)/);
  if (riskMatch?.[1]) {
    return compactText(riskMatch[1], 120);
  }
  if (/短线|拥挤|回撤|涨幅过大|过热/.test(text)) {
    return "短线拥挤或涨幅过大后容易回撤，需要等价格确认。";
  }
  if (impact === "negative") {
    return "先确认负面事件是否影响收入、利润率或订单节奏。";
  }
  return "重点核对消息是否已被价格提前反映。";
}

export function buildSubscriptionReportInsight(
  report: StocksSubscriptionInsightInput,
): StocksSubscriptionInsight {
  const relatedTickers = [...(report.tickers ?? [])];
  const sourceText = [report.fullSummary, report.summary, report.title]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n");
  const fallbackUsed = !report.fullSummary?.trim() && !report.summary?.trim();
  const coreConclusion = fallbackUsed
    ? "总结未生成：保留原文入口，等待后台生成结构化摘要。"
    : compactText(firstUsefulSentence(sourceText) || report.title);
  const impactLabel =
    report.impact === "positive"
      ? "利多"
      : report.impact === "negative"
        ? "利空"
        : "中性";

  return {
    coreConclusion,
    impactLabel,
    relatedTickers,
    impactChain: inferImpactChain(sourceText),
    riskNote: inferRiskNote(sourceText, report.impact),
    fallbackUsed,
  };
}
