export const ALPHA_RESEARCH_DEFAULT_TICKER = "NVDA";

export type AlphaResearchSectorId =
  | "semiconductors"
  | "optical"
  | "cloud-software"
  | "data-center"
  | "storage";

export type AlphaResearchPriority = "A" | "B" | "C";

export type AlphaResearchSession = "pre-market" | "regular" | "after-hours";

export type AlphaResearchEarningsStatus =
  | "recent"
  | "upcoming"
  | "watch"
  | "quiet";

export type AlphaResearchMarketProvider =
  | "finnhub"
  | "massive"
  | "fmp"
  | "alpha-vantage"
  | "yahoo"
  | "mock";
export type AlphaResearchMarketFreshness = "realtime" | "delayed" | "mock";
export type AlphaResearchMarketProviderTraceItem = {
  provider: AlphaResearchMarketProvider;
  status: "success" | "failed" | "skipped";
  message?: string;
  quoteCount?: number;
  timestamp?: string;
};

export type AlphaCatalystType =
  | "earnings"
  | "product"
  | "supply-chain"
  | "analyst"
  | "macro"
  | "regulatory"
  | "industry-event";

export type AlphaResearchSector = {
  id: AlphaResearchSectorId;
  name: string;
  description: string;
  themeScore: number;
  tickers: string[];
};

export type AlphaResearchMarket = {
  lastPrice: number;
  dayChangePct: number;
  prePostChangePct: number;
  prePostAvailable?: boolean;
  sevenDayChangePct: number;
  relativeStrengthLabel: string;
  marketSession: AlphaResearchSession;
  earningsStatus: AlphaResearchEarningsStatus;
  source?: "live" | "mock";
  provider?: AlphaResearchMarketProvider;
  freshness?: AlphaResearchMarketFreshness;
  fallbackUsed?: boolean;
  dataQualityLabel?: string;
  providerTrace?: AlphaResearchMarketProviderTraceItem[];
  updatedAt?: string;
  candlesSource?: "live" | "mock";
};

export type AlphaResearchCatalyst = {
  title: string;
  type: AlphaCatalystType;
  date: string;
  impact: "positive" | "neutral" | "negative";
  summary: string;
  source?: string;
  sourceRole?: "external" | "supplemental" | "mock";
  author?: string;
  link?: string;
};

export type AlphaResearchFinancialSnapshot = {
  revenue: string;
  revenueYoY: string;
  eps: string;
  grossMargin: string;
  freeCashFlow: string;
  nextEarningsDate: string;
  guidance: string;
  periodLabel?: string;
  source?: "live" | "mock";
  updatedAt?: string;
};

export type AlphaResearchCandle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeLabel: string;
};

export type AlphaResearchStock = {
  ticker: string;
  companyName: string;
  sectorId: AlphaResearchSectorId;
  businessTags: string[];
  priority: AlphaResearchPriority;
  summary: string;
  market: AlphaResearchMarket;
  candles3d: AlphaResearchCandle[];
  catalysts: AlphaResearchCatalyst[];
  financialSnapshot: AlphaResearchFinancialSnapshot;
  financialReadthrough: string[];
  thesis: string[];
  watchPoints: string[];
  risks: string[];
};

export const ALPHA_RESEARCH_SECTORS: AlphaResearchSector[] = [
  {
    id: "semiconductors",
    name: "半导体与设备",
    description: "AI GPU、先进制程、高端封装和半导体设备链条。",
    themeScore: 94,
    tickers: ["NVDA", "TSM", "ASML", "AMD", "INTC", "AVGO", "LRCX"],
  },
  {
    id: "storage",
    name: "数据存储",
    description: "HBM、DRAM、NAND、HDD 和数据中心存储周期。",
    themeScore: 82,
    tickers: ["MU", "WDC", "SNDK", "STX", "000660.KS", "005930.KS"],
  },
  {
    id: "optical",
    name: "光通信",
    description: "高速光模块、光器件、网络设备和数据中心互联。",
    themeScore: 88,
    tickers: ["COHR", "LITE", "IPGP", "FN", "CIEN", "GLW"],
  },
  {
    id: "cloud-software",
    name: "云/SaaS/软件",
    description: "云资本开支、AI 平台、数据库、应用软件和数据分析。",
    themeScore: 86,
    tickers: ["MSFT", "AMZN", "GOOG", "ORCL", "NOW", "SNOW", "PLTR"],
  },
  {
    id: "data-center",
    name: "数据中心基础设施",
    description: "AI 服务器、电力、散热、代工和新型云基础设施。",
    themeScore: 90,
    tickers: ["DELL", "VRT", "CLS", "CRWV", "NBIS"],
  },
];

export const ALPHA_RESEARCH_STOCK_UNIVERSE = ALPHA_RESEARCH_SECTORS.flatMap(
  (sector) => sector.tickers,
);

type StockProfile = {
  ticker: string;
  companyName: string;
  sectorId: AlphaResearchSectorId;
  businessTags: string[];
  priority: AlphaResearchPriority;
  summary: string;
  market: AlphaResearchMarket;
  catalystTitle: string;
  catalystType: AlphaCatalystType;
  catalystSummary: string;
  revenue: string;
  revenueYoY: string;
  eps: string;
  grossMargin: string;
  freeCashFlow: string;
  nextEarningsDate: string;
};

const sectorThesis: Record<AlphaResearchSectorId, string> = {
  semiconductors: "它处在 AI 芯片供给、先进制程或设备资本开支的关键环节。",
  optical: "它能反映高速光模块和数据中心互联升级的订单强度。",
  "cloud-software": "它连接云资本开支、AI 平台化和企业软件变现。",
  "data-center": "它能验证 AI 数据中心建设从芯片扩散到电力、散热和服务器的强度。",
  storage: "它能反映 HBM、NAND、HDD 等数据存储周期的修复力度。",
};

const profiles: StockProfile[] = [
  {
    ticker: "NVDA",
    companyName: "NVIDIA",
    sectorId: "semiconductors",
    businessTags: ["AI GPU", "CUDA", "数据中心"],
    priority: "A",
    summary: "AI GPU 需求、Blackwell 出货和云厂商资本开支是核心变量。",
    market: {
      lastPrice: 921.4,
      dayChangePct: 3.8,
      prePostChangePct: 1.2,
      sevenDayChangePct: 11.2,
      relativeStrengthLabel: "组内最强",
      marketSession: "regular",
      earningsStatus: "upcoming",
    },
    catalystTitle: "云资本开支预期上修",
    catalystType: "analyst",
    catalystSummary: "卖方上修 AI 服务器需求假设，市场继续交易 GPU 供给紧张。",
    revenue: "$26.0B",
    revenueYoY: "+18%",
    eps: "$6.12",
    grossMargin: "74.5%",
    freeCashFlow: "$14.9B",
    nextEarningsDate: "2026-05-22",
  },
  {
    ticker: "TSM",
    companyName: "Taiwan Semiconductor",
    sectorId: "semiconductors",
    businessTags: ["先进制程", "CoWoS", "晶圆代工"],
    priority: "A",
    summary: "先进制程和高端封装产能决定 AI 芯片供给上限。",
    market: {
      lastPrice: 166.2,
      dayChangePct: 1.4,
      prePostChangePct: 0.5,
      sevenDayChangePct: 6.8,
      relativeStrengthLabel: "稳健强势",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "高端封装产能继续扩张",
    catalystType: "supply-chain",
    catalystSummary: "市场关注 CoWoS 产能扩张能否缓解 AI 加速卡交付瓶颈。",
    revenue: "$18.9B",
    revenueYoY: "+16%",
    eps: "$1.50",
    grossMargin: "53.2%",
    freeCashFlow: "$5.7B",
    nextEarningsDate: "2026-07-18",
  },
  {
    ticker: "ASML",
    companyName: "ASML Holding",
    sectorId: "semiconductors",
    businessTags: ["EUV", "半导体设备", "先进制程"],
    priority: "A",
    summary: "EUV 订单和先进制程资本开支决定设备周期弹性。",
    market: {
      lastPrice: 931.6,
      dayChangePct: 0.9,
      prePostChangePct: 0.2,
      sevenDayChangePct: 4.1,
      relativeStrengthLabel: "跟随板块",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "先进制程设备订单观察",
    catalystType: "earnings",
    catalystSummary: "投资人等待订单能见度和中国区收入变化的更新。",
    revenue: "EUR 6.7B",
    revenueYoY: "+10%",
    eps: "EUR 4.85",
    grossMargin: "51.0%",
    freeCashFlow: "EUR 1.9B",
    nextEarningsDate: "2026-07-16",
  },
  {
    ticker: "AMD",
    companyName: "Advanced Micro Devices",
    sectorId: "semiconductors",
    businessTags: ["GPU", "CPU", "MI 系列"],
    priority: "A",
    summary: "MI 系列 GPU 渗透率和服务器 CPU 份额是重估关键。",
    market: {
      lastPrice: 158.8,
      dayChangePct: -0.8,
      prePostChangePct: 0.1,
      sevenDayChangePct: 5.5,
      relativeStrengthLabel: "回踩观察",
      marketSession: "regular",
      earningsStatus: "recent",
    },
    catalystTitle: "AI GPU 份额预期分歧",
    catalystType: "product",
    catalystSummary: "市场交易 MI 系列放量速度，同时担心与龙头差距扩大。",
    revenue: "$6.2B",
    revenueYoY: "+12%",
    eps: "$0.88",
    grossMargin: "52.0%",
    freeCashFlow: "$0.9B",
    nextEarningsDate: "2026-07-30",
  },
  {
    ticker: "INTC",
    companyName: "Intel",
    sectorId: "semiconductors",
    businessTags: ["CPU", "Foundry", "先进封装"],
    priority: "B",
    summary: "CPU 份额、防守性现金流、晶圆代工转型和先进制程追赶是核心变量。",
    market: {
      lastPrice: 34.2,
      dayChangePct: 0.6,
      prePostChangePct: 0.1,
      sevenDayChangePct: 2.4,
      relativeStrengthLabel: "转型观察",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "代工和先进制程节点观察",
    catalystType: "supply-chain",
    catalystSummary:
      "市场关注 Intel Foundry 外部客户进展、18A 良率和数据中心 CPU 份额稳定性。",
    revenue: "$12.7B",
    revenueYoY: "+4%",
    eps: "$0.18",
    grossMargin: "40.0%",
    freeCashFlow: "-$1.2B",
    nextEarningsDate: "2026-07-24",
  },
  {
    ticker: "AVGO",
    companyName: "Broadcom",
    sectorId: "semiconductors",
    businessTags: ["ASIC", "网络芯片", "软件"],
    priority: "A",
    summary: "定制 ASIC 和高速网络芯片受益于云厂商自研 AI 芯片。",
    market: {
      lastPrice: 1374.5,
      dayChangePct: 2.2,
      prePostChangePct: 0.7,
      sevenDayChangePct: 8.9,
      relativeStrengthLabel: "强势",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "定制 AI 芯片需求升温",
    catalystType: "industry-event",
    catalystSummary: "云厂商自研芯片带动 ASIC 和网络芯片订单预期。",
    revenue: "$12.5B",
    revenueYoY: "+21%",
    eps: "$10.96",
    grossMargin: "63.8%",
    freeCashFlow: "$5.1B",
    nextEarningsDate: "2026-06-05",
  },
  {
    ticker: "LRCX",
    companyName: "Lam Research",
    sectorId: "semiconductors",
    businessTags: ["刻蚀", "沉积", "存储设备"],
    priority: "B",
    summary: "存储资本开支恢复和先进封装需求是主要弹性来源。",
    market: {
      lastPrice: 948.3,
      dayChangePct: 1.1,
      prePostChangePct: 0.2,
      sevenDayChangePct: 3.7,
      relativeStrengthLabel: "温和修复",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "存储设备周期修复",
    catalystType: "supply-chain",
    catalystSummary: "HBM 与 NAND 供需改善推动设备订单预期改善。",
    revenue: "$3.9B",
    revenueYoY: "+8%",
    eps: "$7.80",
    grossMargin: "47.5%",
    freeCashFlow: "$1.1B",
    nextEarningsDate: "2026-07-25",
  },
  {
    ticker: "COHR",
    companyName: "Coherent",
    sectorId: "optical",
    businessTags: ["光模块", "光材料", "800G/1.6T"],
    priority: "A",
    summary: "高速光模块需求和利润率修复是当前交易主线。",
    market: {
      lastPrice: 74.8,
      dayChangePct: 5.6,
      prePostChangePct: 1.4,
      sevenDayChangePct: 14.2,
      relativeStrengthLabel: "组内最强",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "1.6T 光模块需求预期升温",
    catalystType: "industry-event",
    catalystSummary: "AI 数据中心互联升级推动高速光模块订单预期上行。",
    revenue: "$1.2B",
    revenueYoY: "+11%",
    eps: "$0.72",
    grossMargin: "34.5%",
    freeCashFlow: "$0.2B",
    nextEarningsDate: "2026-08-06",
  },
  {
    ticker: "LITE",
    companyName: "Lumentum",
    sectorId: "optical",
    businessTags: ["光器件", "激光器", "云互联"],
    priority: "B",
    summary: "光器件订单恢复和客户库存去化是主要观察点。",
    market: {
      lastPrice: 58.2,
      dayChangePct: 2.1,
      prePostChangePct: 0.6,
      sevenDayChangePct: 7.5,
      relativeStrengthLabel: "强于板块",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "云客户订单恢复",
    catalystType: "supply-chain",
    catalystSummary: "投资人关注光器件库存调整后的订单回补速度。",
    revenue: "$0.4B",
    revenueYoY: "+6%",
    eps: "$0.29",
    grossMargin: "31.2%",
    freeCashFlow: "$0.1B",
    nextEarningsDate: "2026-08-12",
  },
  {
    ticker: "IPGP",
    companyName: "IPG Photonics",
    sectorId: "optical",
    businessTags: ["光纤激光器", "工业激光", "光学"],
    priority: "C",
    summary: "工业激光周期偏弱，AI 光学相关弹性仍需验证。",
    market: {
      lastPrice: 84.9,
      dayChangePct: 0.4,
      prePostChangePct: 0,
      sevenDayChangePct: 1.8,
      relativeStrengthLabel: "低弹性",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "工业需求底部观察",
    catalystType: "macro",
    catalystSummary: "市场等待工业需求改善和高端光学应用扩展证据。",
    revenue: "$0.3B",
    revenueYoY: "-2%",
    eps: "$0.48",
    grossMargin: "38.0%",
    freeCashFlow: "$0.1B",
    nextEarningsDate: "2026-07-31",
  },
  {
    ticker: "FN",
    companyName: "Fabrinet",
    sectorId: "optical",
    businessTags: ["光模块代工", "数据中心", "制造"],
    priority: "A",
    summary: "高速光模块代工需求直接反映云厂商互联升级。",
    market: {
      lastPrice: 228.6,
      dayChangePct: 3.2,
      prePostChangePct: 0.9,
      sevenDayChangePct: 10.4,
      relativeStrengthLabel: "强势",
      marketSession: "regular",
      earningsStatus: "upcoming",
    },
    catalystTitle: "高速光模块代工订单",
    catalystType: "supply-chain",
    catalystSummary: "客户升级 800G/1.6T 互联带动代工能见度改善。",
    revenue: "$0.7B",
    revenueYoY: "+15%",
    eps: "$2.10",
    grossMargin: "12.8%",
    freeCashFlow: "$0.2B",
    nextEarningsDate: "2026-05-20",
  },
  {
    ticker: "CIEN",
    companyName: "Ciena",
    sectorId: "optical",
    businessTags: ["网络设备", "光传输", "运营商"],
    priority: "B",
    summary: "数据中心互联强度需要抵消运营商需求波动。",
    market: {
      lastPrice: 51.7,
      dayChangePct: 1.7,
      prePostChangePct: 0.3,
      sevenDayChangePct: 4.9,
      relativeStrengthLabel: "跟随修复",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "数据中心互联项目更新",
    catalystType: "product",
    catalystSummary: "市场关注云互联需求能否提高订单质量。",
    revenue: "$1.0B",
    revenueYoY: "+5%",
    eps: "$0.67",
    grossMargin: "43.1%",
    freeCashFlow: "$0.2B",
    nextEarningsDate: "2026-06-06",
  },
  {
    ticker: "GLW",
    companyName: "Corning",
    sectorId: "optical",
    businessTags: ["光纤", "材料", "连接器"],
    priority: "B",
    summary: "光纤材料需求受益于数据中心建设和网络升级。",
    market: {
      lastPrice: 36.4,
      dayChangePct: 0.8,
      prePostChangePct: 0.1,
      sevenDayChangePct: 2.6,
      relativeStrengthLabel: "稳健",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "光纤需求温和改善",
    catalystType: "industry-event",
    catalystSummary: "AI 数据中心建设提供中期需求支撑。",
    revenue: "$3.3B",
    revenueYoY: "+4%",
    eps: "$0.38",
    grossMargin: "35.0%",
    freeCashFlow: "$0.5B",
    nextEarningsDate: "2026-07-29",
  },
  {
    ticker: "MSFT",
    companyName: "Microsoft",
    sectorId: "cloud-software",
    businessTags: ["Azure", "Copilot", "企业软件"],
    priority: "A",
    summary: "Azure AI 增速、Copilot 渗透率和资本开支效率是核心变量。",
    market: {
      lastPrice: 429.5,
      dayChangePct: 1.5,
      prePostChangePct: 0.4,
      sevenDayChangePct: 5.8,
      relativeStrengthLabel: "稳健强势",
      marketSession: "regular",
      earningsStatus: "recent",
    },
    catalystTitle: "Azure AI 消费增长",
    catalystType: "earnings",
    catalystSummary: "财报后市场继续关注 AI 服务对云增速的拉动。",
    revenue: "$61.9B",
    revenueYoY: "+17%",
    eps: "$2.94",
    grossMargin: "69.3%",
    freeCashFlow: "$21.0B",
    nextEarningsDate: "2026-07-24",
  },
  {
    ticker: "AMZN",
    companyName: "Amazon",
    sectorId: "cloud-software",
    businessTags: ["AWS", "自研芯片", "电商现金流"],
    priority: "A",
    summary: "AWS AI 增速和资本开支回报决定云链条情绪。",
    market: {
      lastPrice: 184.1,
      dayChangePct: 1.2,
      prePostChangePct: 0.3,
      sevenDayChangePct: 4.3,
      relativeStrengthLabel: "稳健",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "AWS AI 订单观察",
    catalystType: "earnings",
    catalystSummary: "市场关注 AWS AI 收入贡献和 Trainium 进展。",
    revenue: "$143.3B",
    revenueYoY: "+12%",
    eps: "$0.98",
    grossMargin: "48.0%",
    freeCashFlow: "$36.8B",
    nextEarningsDate: "2026-08-01",
  },
  {
    ticker: "GOOG",
    companyName: "Alphabet",
    sectorId: "cloud-software",
    businessTags: ["Google Cloud", "TPU", "搜索 AI"],
    priority: "A",
    summary: "Google Cloud 增速、TPU 生态和搜索 AI 货币化是关键。",
    market: {
      lastPrice: 171.9,
      dayChangePct: 0.9,
      prePostChangePct: 0.2,
      sevenDayChangePct: 3.9,
      relativeStrengthLabel: "跟随大盘",
      marketSession: "regular",
      earningsStatus: "recent",
    },
    catalystTitle: "TPU 与云 AI 进展",
    catalystType: "product",
    catalystSummary: "投资人关注 AI 产品迭代是否转化为云增长和广告效率。",
    revenue: "$80.5B",
    revenueYoY: "+14%",
    eps: "$1.89",
    grossMargin: "57.0%",
    freeCashFlow: "$16.8B",
    nextEarningsDate: "2026-07-23",
  },
  {
    ticker: "ORCL",
    companyName: "Oracle",
    sectorId: "cloud-software",
    businessTags: ["OCI", "数据库", "AI 云合同"],
    priority: "A",
    summary: "OCI 大单和数据库迁移是云基础设施补涨线索。",
    market: {
      lastPrice: 124.6,
      dayChangePct: 2.6,
      prePostChangePct: 0.8,
      sevenDayChangePct: 9.1,
      relativeStrengthLabel: "强势",
      marketSession: "regular",
      earningsStatus: "upcoming",
    },
    catalystTitle: "AI 云合同积压提升",
    catalystType: "earnings",
    catalystSummary: "市场交易 OCI 合同积压和 GPU 云交付速度。",
    revenue: "$13.3B",
    revenueYoY: "+11%",
    eps: "$1.41",
    grossMargin: "72.0%",
    freeCashFlow: "$8.5B",
    nextEarningsDate: "2026-06-12",
  },
  {
    ticker: "NOW",
    companyName: "ServiceNow",
    sectorId: "cloud-software",
    businessTags: ["工作流", "企业 AI", "SaaS"],
    priority: "B",
    summary: "企业 AI 工作流变现和续约质量是核心观察点。",
    market: {
      lastPrice: 742.3,
      dayChangePct: 0.7,
      prePostChangePct: 0.2,
      sevenDayChangePct: 2.7,
      relativeStrengthLabel: "稳健",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "企业 AI 工作流采用",
    catalystType: "product",
    catalystSummary: "市场关注 AI 功能能否提升客单价和净留存。",
    revenue: "$2.6B",
    revenueYoY: "+22%",
    eps: "$3.41",
    grossMargin: "79.0%",
    freeCashFlow: "$0.8B",
    nextEarningsDate: "2026-07-24",
  },
  {
    ticker: "SNOW",
    companyName: "Snowflake",
    sectorId: "cloud-software",
    businessTags: ["数据云", "AI 数据层", "消费型 SaaS"],
    priority: "B",
    summary: "数据云消费恢复和 AI 应用层拉动是估值修复关键。",
    market: {
      lastPrice: 151.2,
      dayChangePct: 1.9,
      prePostChangePct: 0.5,
      sevenDayChangePct: 6.1,
      relativeStrengthLabel: "修复",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "数据消费趋势改善",
    catalystType: "earnings",
    catalystSummary: "投资人关注客户优化压力是否缓解。",
    revenue: "$0.8B",
    revenueYoY: "+26%",
    eps: "$0.35",
    grossMargin: "72.5%",
    freeCashFlow: "$0.3B",
    nextEarningsDate: "2026-05-28",
  },
  {
    ticker: "PLTR",
    companyName: "Palantir",
    sectorId: "cloud-software",
    businessTags: ["AI 平台", "政府", "企业数据"],
    priority: "B",
    summary: "AIP 商业化速度和政府订单能见度决定高估值承接。",
    market: {
      lastPrice: 22.7,
      dayChangePct: 3.4,
      prePostChangePct: 1.1,
      sevenDayChangePct: 12.8,
      relativeStrengthLabel: "高弹性",
      marketSession: "regular",
      earningsStatus: "recent",
    },
    catalystTitle: "AIP 商业客户扩张",
    catalystType: "product",
    catalystSummary: "市场交易 AI 平台从试点转向生产部署的速度。",
    revenue: "$0.7B",
    revenueYoY: "+20%",
    eps: "$0.08",
    grossMargin: "81.0%",
    freeCashFlow: "$0.2B",
    nextEarningsDate: "2026-08-05",
  },
  {
    ticker: "DELL",
    companyName: "Dell Technologies",
    sectorId: "data-center",
    businessTags: ["AI 服务器", "企业硬件", "存储"],
    priority: "A",
    summary: "AI 服务器订单和毛利率是服务器链条核心验证点。",
    market: {
      lastPrice: 132.8,
      dayChangePct: 1.1,
      prePostChangePct: 0.4,
      sevenDayChangePct: 5.9,
      relativeStrengthLabel: "稳健",
      marketSession: "regular",
      earningsStatus: "upcoming",
    },
    catalystTitle: "AI 服务器订单积压",
    catalystType: "earnings",
    catalystSummary: "市场关注订单增长能否转化为利润率改善。",
    revenue: "$22.3B",
    revenueYoY: "+7%",
    eps: "$1.88",
    grossMargin: "23.1%",
    freeCashFlow: "$1.4B",
    nextEarningsDate: "2026-05-30",
  },
  {
    ticker: "VRT",
    companyName: "Vertiv",
    sectorId: "data-center",
    businessTags: ["电力", "散热", "数据中心"],
    priority: "A",
    summary: "AI 数据中心电力和液冷需求是基础设施强势主线。",
    market: {
      lastPrice: 92.5,
      dayChangePct: 2.9,
      prePostChangePct: 0.9,
      sevenDayChangePct: 10.7,
      relativeStrengthLabel: "强势",
      marketSession: "regular",
      earningsStatus: "recent",
    },
    catalystTitle: "液冷和电力需求上行",
    catalystType: "industry-event",
    catalystSummary: "AI 集群功耗提升推动电力与散热基础设施订单。",
    revenue: "$1.9B",
    revenueYoY: "+15%",
    eps: "$0.43",
    grossMargin: "36.5%",
    freeCashFlow: "$0.3B",
    nextEarningsDate: "2026-07-31",
  },
  {
    ticker: "CLS",
    companyName: "Celestica",
    sectorId: "data-center",
    businessTags: ["服务器代工", "网络硬件", "EMS"],
    priority: "B",
    summary: "云客户硬件需求和网络设备订单决定弹性。",
    market: {
      lastPrice: 52.3,
      dayChangePct: 2.0,
      prePostChangePct: 0.4,
      sevenDayChangePct: 7.9,
      relativeStrengthLabel: "强于板块",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "云硬件订单改善",
    catalystType: "supply-chain",
    catalystSummary: "市场关注 AI 服务器和网络硬件代工需求。",
    revenue: "$2.1B",
    revenueYoY: "+13%",
    eps: "$0.86",
    grossMargin: "10.4%",
    freeCashFlow: "$0.1B",
    nextEarningsDate: "2026-07-26",
  },
  {
    ticker: "CRWV",
    companyName: "CoreWeave",
    sectorId: "data-center",
    businessTags: ["GPU 云", "AI 基础设施", "租赁"],
    priority: "B",
    summary: "GPU 云利用率、融资成本和客户集中度是核心变量。",
    market: {
      lastPrice: 41.6,
      dayChangePct: 4.2,
      prePostChangePct: 1.6,
      sevenDayChangePct: 13.5,
      relativeStrengthLabel: "高弹性",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "GPU 云需求升温",
    catalystType: "industry-event",
    catalystSummary: "AI 训练需求继续支撑 GPU 云租赁和基础设施扩张叙事。",
    revenue: "$0.6B",
    revenueYoY: "+55%",
    eps: "$0.12",
    grossMargin: "51.0%",
    freeCashFlow: "-$0.4B",
    nextEarningsDate: "2026-08-14",
  },
  {
    ticker: "NBIS",
    companyName: "Nebius",
    sectorId: "data-center",
    businessTags: ["AI 云", "欧洲算力", "GPU 集群"],
    priority: "C",
    summary: "小市值 AI 云弹性高，但融资和执行风险也更高。",
    market: {
      lastPrice: 29.8,
      dayChangePct: 3.1,
      prePostChangePct: 1.0,
      sevenDayChangePct: 9.6,
      relativeStrengthLabel: "高波动",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "欧洲 AI 云扩张",
    catalystType: "industry-event",
    catalystSummary: "市场关注区域 AI 云需求和 GPU 集群建设进度。",
    revenue: "$0.2B",
    revenueYoY: "+35%",
    eps: "-$0.20",
    grossMargin: "38.0%",
    freeCashFlow: "-$0.2B",
    nextEarningsDate: "2026-08-20",
  },
  {
    ticker: "MU",
    companyName: "Micron",
    sectorId: "storage",
    businessTags: ["HBM", "DRAM", "NAND"],
    priority: "A",
    summary: "HBM 供给紧张和存储价格周期是核心弹性来源。",
    market: {
      lastPrice: 118.4,
      dayChangePct: 2.8,
      prePostChangePct: 0.7,
      sevenDayChangePct: 8.4,
      relativeStrengthLabel: "强势",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "HBM 价格与产能改善",
    catalystType: "supply-chain",
    catalystSummary: "AI GPU 需求拉动 HBM 价格和供给能见度。",
    revenue: "$5.8B",
    revenueYoY: "+32%",
    eps: "$0.45",
    grossMargin: "28.0%",
    freeCashFlow: "$0.4B",
    nextEarningsDate: "2026-06-26",
  },
  {
    ticker: "WDC",
    companyName: "Western Digital",
    sectorId: "storage",
    businessTags: ["HDD", "NAND", "数据中心存储"],
    priority: "B",
    summary: "数据中心 HDD 需求和 NAND 周期决定利润率恢复。",
    market: {
      lastPrice: 72.1,
      dayChangePct: 1.6,
      prePostChangePct: 0.3,
      sevenDayChangePct: 6.2,
      relativeStrengthLabel: "修复",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "数据中心存储需求改善",
    catalystType: "supply-chain",
    catalystSummary: "云客户存储采购改善支撑 HDD 与 NAND 定价。",
    revenue: "$3.5B",
    revenueYoY: "+18%",
    eps: "$0.71",
    grossMargin: "26.5%",
    freeCashFlow: "$0.3B",
    nextEarningsDate: "2026-08-01",
  },
  {
    ticker: "SNDK",
    companyName: "SanDisk",
    sectorId: "storage",
    businessTags: ["NAND", "SSD", "消费存储"],
    priority: "C",
    summary: "NAND 周期修复提供弹性，但业务质量需要继续验证。",
    market: {
      lastPrice: 39.6,
      dayChangePct: 1.0,
      prePostChangePct: 0.2,
      sevenDayChangePct: 4.1,
      relativeStrengthLabel: "跟随修复",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "NAND 定价修复",
    catalystType: "macro",
    catalystSummary: "市场观察 NAND 价格和库存去化的持续性。",
    revenue: "$1.7B",
    revenueYoY: "+10%",
    eps: "$0.22",
    grossMargin: "24.0%",
    freeCashFlow: "$0.1B",
    nextEarningsDate: "2026-08-08",
  },
  {
    ticker: "STX",
    companyName: "Seagate",
    sectorId: "storage",
    businessTags: ["HDD", "Nearline", "数据中心"],
    priority: "B",
    summary: "Nearline HDD 需求和价格恢复是数据中心存储链条补涨点。",
    market: {
      lastPrice: 92.4,
      dayChangePct: 1.3,
      prePostChangePct: 0.3,
      sevenDayChangePct: 5.4,
      relativeStrengthLabel: "稳健修复",
      marketSession: "regular",
      earningsStatus: "quiet",
    },
    catalystTitle: "Nearline HDD 需求恢复",
    catalystType: "supply-chain",
    catalystSummary: "AI 数据增长推动大容量 HDD 需求改善。",
    revenue: "$1.9B",
    revenueYoY: "+12%",
    eps: "$0.74",
    grossMargin: "28.5%",
    freeCashFlow: "$0.3B",
    nextEarningsDate: "2026-07-24",
  },
  {
    ticker: "000660.KS",
    companyName: "SK hynix",
    sectorId: "storage",
    businessTags: ["HBM", "DRAM", "NAND"],
    priority: "A",
    summary: "HBM 供给、DRAM 定价和 AI 服务器内存需求是核心变量。",
    market: {
      lastPrice: 1635000,
      dayChangePct: -1.2,
      prePostChangePct: 0,
      sevenDayChangePct: 26.5,
      relativeStrengthLabel: "HBM 强势",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "HBM 订单和产能爬坡",
    catalystType: "supply-chain",
    catalystSummary: "市场关注 HBM3E/HBM4 供给份额、主要 AI 客户认证和资本开支节奏。",
    revenue: "KRW 17.6T",
    revenueYoY: "+39%",
    eps: "KRW 5,300",
    grossMargin: "42.0%",
    freeCashFlow: "KRW 2.1T",
    nextEarningsDate: "2026-07-25",
  },
  {
    ticker: "005930.KS",
    companyName: "Samsung Electronics",
    sectorId: "storage",
    businessTags: ["HBM", "DRAM", "NAND", "Foundry"],
    priority: "A",
    summary: "存储价格、HBM 认证进展和晶圆代工修复决定估值弹性。",
    market: {
      lastPrice: 266000,
      dayChangePct: 14.4,
      prePostChangePct: 0,
      sevenDayChangePct: 22.3,
      relativeStrengthLabel: "修复跟踪",
      marketSession: "regular",
      earningsStatus: "watch",
    },
    catalystTitle: "HBM 客户认证和存储周期修复",
    catalystType: "supply-chain",
    catalystSummary: "市场观察三星 HBM 认证进展、DRAM/NAND 报价和半导体部门利润率修复。",
    revenue: "KRW 71.9T",
    revenueYoY: "+18%",
    eps: "KRW 1,450",
    grossMargin: "37.0%",
    freeCashFlow: "KRW 4.8T",
    nextEarningsDate: "2026-07-31",
  },
];

function buildStock(profile: StockProfile): AlphaResearchStock {
  return {
    ticker: profile.ticker,
    companyName: profile.companyName,
    sectorId: profile.sectorId,
    businessTags: profile.businessTags,
    priority: profile.priority,
    summary: profile.summary,
    market: profile.market,
    candles3d: buildCandles3d(profile.market),
    catalysts: [
      {
        title: profile.catalystTitle,
        type: profile.catalystType,
        date: "2026-05-06",
        impact: profile.market.dayChangePct > 0 ? "positive" : "neutral",
        summary: profile.catalystSummary,
      },
    ],
    financialSnapshot: {
      revenue: profile.revenue,
      revenueYoY: profile.revenueYoY,
      eps: profile.eps,
      grossMargin: profile.grossMargin,
      freeCashFlow: profile.freeCashFlow,
      nextEarningsDate: profile.nextEarningsDate,
      guidance: `${profile.companyName} 的 mock 指引聚焦 AI 需求、订单可见度和利润率变化。`,
    },
    financialReadthrough: [
      `${profile.companyName} 的收入弹性主要取决于 ${profile.businessTags[0]} 的需求斜率。`,
      "需要观察毛利率是否能跟随 AI 相关产品占比提升而改善。",
      "下一次财报前，重点跟踪订单、资本开支和管理层指引变化。",
    ],
    thesis: [profile.summary, sectorThesis[profile.sectorId]],
    watchPoints: [
      "盘前盘后异动是否被成交量确认。",
      "客户资本开支、供应链交付和财报指引是否同步改善。",
      "相对板块强度是否持续超过同组 ticker。",
    ],
    risks: [
      "估值已经反映较高增长预期。",
      "订单节奏、供应链约束或宏观利率变化可能压制风险偏好。",
    ],
  };
}

function roundPrice(value: number) {
  return Math.round(value * 100) / 100;
}

function makeCandle({
  date,
  open,
  close,
  rangePct,
  volumeLabel,
}: {
  date: string;
  open: number;
  close: number;
  rangePct: number;
  volumeLabel: string;
}): AlphaResearchCandle {
  const maxBody = Math.max(open, close);
  const minBody = Math.min(open, close);
  const range = Math.max(close * rangePct, close * 0.006);
  return {
    date,
    open: roundPrice(open),
    high: roundPrice(maxBody + range),
    low: roundPrice(Math.max(0.01, minBody - range * 0.82)),
    close: roundPrice(close),
    volumeLabel,
  };
}

function buildCandles3d(market: AlphaResearchMarket): AlphaResearchCandle[] {
  const dayMove = market.dayChangePct / 100;
  const recentMove = Math.max(-0.18, Math.min(0.22, market.sevenDayChangePct / 100));
  const close3 = market.lastPrice;
  const close2 = close3 / (1 + dayMove || 1);
  const close1 = close3 / (1 + recentMove * 0.72 || 1);
  const open1 = close1 * (1 - recentMove * 0.18);
  const open2 = close1 * (1 + recentMove * 0.2);
  const open3 = close2 * (1 + dayMove * 0.35);

  return [
    makeCandle({
      date: "05-04",
      open: open1,
      close: close1,
      rangePct: 0.018,
      volumeLabel: "1.0x",
    }),
    makeCandle({
      date: "05-05",
      open: open2,
      close: close2,
      rangePct: 0.016,
      volumeLabel: "1.2x",
    }),
    makeCandle({
      date: "05-06",
      open: open3,
      close: close3,
      rangePct: Math.abs(dayMove) > 0.03 ? 0.024 : 0.015,
      volumeLabel: Math.abs(market.dayChangePct) > 2 ? "1.8x" : "1.1x",
    }),
  ];
}

export const ALPHA_RESEARCH_STOCKS: AlphaResearchStock[] =
  profiles.map(buildStock);

export function getAlphaResearchSectorById(
  id: string,
): AlphaResearchSector | null {
  return ALPHA_RESEARCH_SECTORS.find((sector) => sector.id === id) ?? null;
}

export function getAlphaResearchStockByTicker(
  ticker: string,
): AlphaResearchStock | null {
  const normalized = ticker.trim().toUpperCase();
  return (
    ALPHA_RESEARCH_STOCKS.find((stock) => stock.ticker === normalized) ?? null
  );
}

export function getAlphaResearchStocksForSector(
  sectorId: AlphaResearchSectorId,
): AlphaResearchStock[] {
  const sector = getAlphaResearchSectorById(sectorId);
  if (!sector) return [];
  const rank = new Map(sector.tickers.map((ticker, index) => [ticker, index]));
  return ALPHA_RESEARCH_STOCKS.filter(
    (stock) => stock.sectorId === sectorId,
  ).sort(
    (left, right) =>
      (rank.get(left.ticker) ?? 0) - (rank.get(right.ticker) ?? 0),
  );
}

export function getDefaultAlphaResearchStock(): AlphaResearchStock {
  return (
    getAlphaResearchStockByTicker(ALPHA_RESEARCH_DEFAULT_TICKER) ??
    ALPHA_RESEARCH_STOCKS[0]
  );
}
