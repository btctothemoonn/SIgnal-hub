export type UsStockHoldingKind = "equity" | "option";

export type UsStockHoldingPosition = {
  id: string;
  kind: UsStockHoldingKind;
  name: string;
  symbol: string;
  market: "US";
  quantity: number;
  marketValue: number;
  currentPrice: number;
  costBasis: number;
  unrealizedPnl: number;
  theme: string;
  tags: string[];
  option?: {
    underlying: string;
    type: "PUT" | "CALL";
    expiry: string;
    strike: number;
  };
};

export type UsStockHoldingSnapshot = {
  accountLabel: string;
  currency: "USD";
  updatedAt: string;
  reportedPositionCount: number;
  reportedMarketValue: number;
  reportedPnl: number;
  positions: UsStockHoldingPosition[];
};

export type UsStockHoldingAnalysis = {
  totalMarketValue: number;
  reportedMarketValueDelta: number;
  totalPnl: number;
  totalCost: number;
  totalPnlPercent: number;
  winningCount: number;
  losingCount: number;
  optionMarketValue: number;
  optionPnl: number;
  topPosition: UsStockHoldingPosition | null;
  largestLoss: UsStockHoldingPosition | null;
  topThreeWeight: number;
};

export type UsStockHoldingBriefCard = {
  id: string;
  kind: UsStockHoldingKind;
  name: string;
  symbol: string;
  quantity: number;
  marketValue: number;
  currentPrice: number;
  costBasis: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  weightPercent: number;
  fee: number | null;
  theme: string;
  tags: string[];
  optionLabel: string | null;
};

export type UsStockHoldingGroups = {
  equity: UsStockHoldingPosition[];
  option: UsStockHoldingPosition[];
};

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function percent(value: number) {
  return Math.round(value * 100) / 100;
}

function optionLabel(position: UsStockHoldingPosition) {
  if (!position.option) return null;
  const side = position.option.type === "PUT" ? "P" : "C";
  return `${position.option.underlying} ${position.option.strike}${side} ${position.option.expiry}`;
}

const THEME_DISPLAY_NAME: Record<string, string> = {
  "AI semiconductor": "半导体",
  Semiconductor: "半导体",
  "Memory chain": "存储链",
  Optical: "光通信",
  "Network equipment": "通信设备",
  "AI server": "AI 服务器",
  "Option hedge": "期权保护",
  Options: "期权保护",
  "Social platform": "社交平台",
  "Storage chain": "存储链",
  Energy: "能源",
  "US equity": "美股持仓",
};

export function localizeUsStockTheme(theme: string) {
  return THEME_DISPLAY_NAME[theme] ?? theme;
}

export const US_STOCK_HOLDING_SNAPSHOT: UsStockHoldingSnapshot = {
  accountLabel: "综合账户证券",
  currency: "USD",
  updatedAt: "2026-05-20T22:06:00+08:00",
  reportedPositionCount: 12,
  reportedMarketValue: 26387.86,
  reportedPnl: -1762.85,
  positions: [
    {
      id: "arm",
      kind: "equity",
      name: "ARM Holdings",
      symbol: "ARM",
      market: "US",
      quantity: 15,
      marketValue: 3808.88,
      currentPrice: 254.13,
      costBasis: 221.68,
      unrealizedPnl: 137.71,
      theme: "半导体",
      tags: ["IP", "AI", "CPU"],
    },
    {
      id: "dram",
      kind: "equity",
      name: "Roundhill MEME ETF",
      symbol: "DRAM",
      market: "US",
      quantity: 198,
      marketValue: 9973.26,
      currentPrice: 50.38,
      costBasis: 51.29,
      unrealizedPnl: -174.34,
      theme: "存储链",
      tags: ["DRAM", "HBM", "ETF"],
    },
    {
      id: "lite",
      kind: "equity",
      name: "Lumentum Holdings",
      symbol: "LITE",
      market: "US",
      quantity: 2,
      marketValue: 1785.8,
      currentPrice: 892.9,
      costBasis: 940.8,
      unrealizedPnl: -133.01,
      theme: "光通信",
      tags: ["Optical", "AI infra"],
    },
    {
      id: "mu",
      kind: "equity",
      name: "美光科技",
      symbol: "MU",
      market: "US",
      quantity: 5,
      marketValue: 3555.87,
      currentPrice: 711.73,
      costBasis: 802.74,
      unrealizedPnl: -474.59,
      theme: "存储链",
      tags: ["DRAM", "HBM", "Memory"],
    },
    {
      id: "nok",
      kind: "equity",
      name: "诺基亚",
      symbol: "NOK",
      market: "US",
      quantity: 137,
      marketValue: 1841.27,
      currentPrice: 13.44,
      costBasis: 14.5,
      unrealizedPnl: -144.37,
      theme: "光通信",
      tags: ["Optical", "Network"],
    },
    {
      id: "peng",
      kind: "equity",
      name: "Penguin Solutions",
      symbol: "PENG",
      market: "US",
      quantity: 20,
      marketValue: 933.3,
      currentPrice: 46.66,
      costBasis: 54.1,
      unrealizedPnl: -148.68,
      theme: "AI 服务器",
      tags: ["AI server", "Infra"],
    },
    {
      id: "pltr-put-105",
      kind: "option",
      name: "PLTR PUT",
      symbol: "PLTR 20260717 105P",
      market: "US",
      quantity: 1,
      marketValue: 136,
      currentPrice: 1.36,
      costBasis: 5.18,
      unrealizedPnl: -382.21,
      theme: "期权保护",
      tags: ["PUT", "PLTR"],
      option: {
        underlying: "PLTR",
        type: "PUT",
        expiry: "2026-07-17",
        strike: 105,
      },
    },
    {
      id: "pltr-put-115",
      kind: "option",
      name: "PLTR PUT",
      symbol: "PLTR 20260717 115P",
      market: "US",
      quantity: 1,
      marketValue: 270,
      currentPrice: 2.7,
      costBasis: 7.83,
      unrealizedPnl: -513.21,
      theme: "期权保护",
      tags: ["PUT", "PLTR"],
      option: {
        underlying: "PLTR",
        type: "PUT",
        expiry: "2026-07-17",
        strike: 115,
      },
    },
    {
      id: "rddt",
      kind: "equity",
      name: "Reddit",
      symbol: "RDDT",
      market: "US",
      quantity: 7,
      marketValue: 1029.29,
      currentPrice: 147.04,
      costBasis: 158.41,
      unrealizedPnl: -79.55,
      theme: "社交平台",
      tags: ["Social", "AI data"],
    },
    {
      id: "sndk",
      kind: "equity",
      name: "闪迪",
      symbol: "SNDK",
      market: "US",
      quantity: 1,
      marketValue: 1395.23,
      currentPrice: 1394.2,
      costBasis: 1523.49,
      unrealizedPnl: -127.83,
      theme: "存储链",
      tags: ["NAND", "SSD"],
    },
    {
      id: "te",
      kind: "equity",
      name: "T1 Energy Inc",
      symbol: "TE",
      market: "US",
      quantity: 200,
      marketValue: 1660,
      currentPrice: 8.33,
      costBasis: 6.9,
      unrealizedPnl: 277.23,
      theme: "能源",
      tags: ["Energy"],
    },
  ],
};

function byMarketValueDesc(
  left: UsStockHoldingPosition,
  right: UsStockHoldingPosition,
) {
  return right.marketValue - left.marketValue || left.symbol.localeCompare(right.symbol);
}

function byPnlAsc(left: UsStockHoldingPosition, right: UsStockHoldingPosition) {
  return left.unrealizedPnl - right.unrealizedPnl || left.symbol.localeCompare(right.symbol);
}

function positionPnlPercent(position: UsStockHoldingPosition) {
  const costValue = position.marketValue - position.unrealizedPnl;
  return costValue > 0 ? percent((position.unrealizedPnl / costValue) * 100) : 0;
}

export function analyzeUsStockHoldings(
  positions: UsStockHoldingPosition[],
  snapshot = US_STOCK_HOLDING_SNAPSHOT,
): UsStockHoldingAnalysis {
  const totalMarketValue = money(
    positions.reduce((total, position) => total + position.marketValue, 0),
  );
  const totalPnl = money(
    positions.reduce((total, position) => total + position.unrealizedPnl, 0),
  );
  const totalCost = money(totalMarketValue - totalPnl);
  const optionPositions = positions.filter((position) => position.kind === "option");
  const topByValue = [...positions].sort(byMarketValueDesc);
  const losses = positions.filter((position) => position.unrealizedPnl < 0);
  const topThreeValue = topByValue
    .slice(0, 3)
    .reduce((total, position) => total + position.marketValue, 0);

  return {
    totalMarketValue,
    reportedMarketValueDelta: money(totalMarketValue - snapshot.reportedMarketValue),
    totalPnl,
    totalCost,
    totalPnlPercent: totalCost > 0 ? (totalPnl / totalCost) * 100 : 0,
    winningCount: positions.filter((position) => position.unrealizedPnl > 0).length,
    losingCount: losses.length,
    optionMarketValue: money(
      optionPositions.reduce((total, position) => total + position.marketValue, 0),
    ),
    optionPnl: money(
      optionPositions.reduce((total, position) => total + position.unrealizedPnl, 0),
    ),
    topPosition: topByValue[0] ?? null,
    largestLoss: [...losses].sort(byPnlAsc)[0] ?? null,
    topThreeWeight: totalMarketValue > 0 ? (topThreeValue / totalMarketValue) * 100 : 0,
  };
}

export function getUsStockHoldingGroups(
  positions: UsStockHoldingPosition[],
): UsStockHoldingGroups {
  return {
    equity: positions
      .filter((position) => position.kind === "equity")
      .sort(byMarketValueDesc),
    option: positions
      .filter((position) => position.kind === "option")
      .sort(byMarketValueDesc),
  };
}

export function getUsStockHoldingBriefCards(
  snapshot: UsStockHoldingSnapshot,
): UsStockHoldingBriefCard[] {
  const positions = [...snapshot.positions].sort(byMarketValueDesc);
  const fallbackTotal = positions.reduce(
    (sum, position) => sum + position.marketValue,
    0,
  );
  const totalMarketValue =
    snapshot.reportedMarketValue > 0 ? snapshot.reportedMarketValue : fallbackTotal;

  return positions.map((position) => ({
    id: position.id,
    kind: position.kind,
    name: position.name,
    symbol: position.symbol,
    quantity: position.quantity,
    marketValue: position.marketValue,
    currentPrice: position.currentPrice,
    costBasis: position.costBasis,
    unrealizedPnl: position.unrealizedPnl,
    unrealizedPnlPercent: positionPnlPercent(position),
    weightPercent:
      totalMarketValue > 0 ? percent((position.marketValue / totalMarketValue) * 100) : 0,
    fee: null,
    theme: localizeUsStockTheme(position.theme),
    tags: position.tags,
    optionLabel: optionLabel(position),
  }));
}

export function getUsStockThemeAllocation(positions: UsStockHoldingPosition[]) {
  const map = new Map<string, { theme: string; marketValue: number; pnl: number }>();
  for (const position of positions) {
    const theme = localizeUsStockTheme(position.theme);
    const current = map.get(theme) ?? {
      theme,
      marketValue: 0,
      pnl: 0,
    };
    current.marketValue += position.marketValue;
    current.pnl += position.unrealizedPnl;
    map.set(theme, current);
  }
  const total = positions.reduce((sum, position) => sum + position.marketValue, 0);
  return [...map.values()]
    .map((item) => ({
      ...item,
      marketValue: money(item.marketValue),
      pnl: money(item.pnl),
      weight: total > 0 ? (item.marketValue / total) * 100 : 0,
    }))
    .sort((left, right) => right.marketValue - left.marketValue);
}
