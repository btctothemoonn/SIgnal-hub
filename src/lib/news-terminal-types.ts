export type NewsCoin = {
  symbol: string;
  assetId: string | null;
  marketCapAtPublish: number | null;
};
export type NewsItem = {
  id: string;
  no: number | null;
  publishedAt: number;
  receivedAt: number;
  channels: string[];
  kind: string;
  source: string;
  sourceName: string;
  title: string;
  original: string;
  url: string;
  images: string[];
  coins: NewsCoin[];
  digest: string[];
  score: number;
};
export type NewsWorkerStatus = {
  enabled: boolean;
  connected: boolean;
  updatedAt: number | null;
  lastMessageAt: number | null;
  error: string | null;
};
export type NewsFeed = {
  items: NewsItem[];
  nextCursor: string | null;
  status: NewsWorkerStatus;
};
export type NewsSourceSummary = {
  source: string;
  name: string;
  count: number;
  count24h: number;
  lastAt: number | null;
  blocked: boolean;
};
export type NewsCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
export type NewsMarket = {
  symbol: string;
  pair: string | null;
  venue: "binance" | "hyperliquid";
  tradable: boolean;
  price: number | null;
  change24h: number | null;
  marketCap: number | null;
  fdv: number | null;
  volume24h: number | null;
  fundingRate: number | null;
  openInterest: number | null;
  candles: NewsCandle[];
  fetchedAt: number;
  error: string | null;
};
export type NewsReaction = { minutes: number; change: number | null };
export type NewsDetail = {
  item: NewsItem;
  relatedNews: NewsItem[];
  reactions: NewsReaction[];
  signals: { title: string; occurredAt: string; url: string }[];
};

export type TradeVenue = "binance" | "hyperliquid";
export type TradePosition = {
  symbol: string;
  side: "long" | "short";
  size: number;
  notional: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  liquidationPrice: number | null;
  leverage: number;
};
export type TradeOrder = {
  id: string;
  symbol: string;
  side: string;
  type: string;
  price: number | null;
  size: number;
  status: string;
  createdAt: number;
};
export type TradeAccount = {
  venue: TradeVenue;
  configured: boolean;
  connected: boolean;
  availableBalance: number | null;
  equity: number | null;
  positions: TradePosition[];
  orders: TradeOrder[];
  error: string | null;
  updatedAt: number | null;
};
export type TradeLimits = {
  maxOrderNotional: number;
  maxSymbolNotional: number;
  maxTotalNotional: number;
  maxLeverage: number;
  maxDailyLoss: number;
  slippagePct: number;
};
export type TradeStatus = {
  enabled: boolean;
  mode: "readonly" | "live";
  unlocked: boolean;
  csrfToken: string;
  accounts: TradeAccount[];
  limits: TradeLimits;
  logs: {
    id: string;
    createdAt: number;
    venue: string;
    symbol: string;
    status: string;
    message: string;
  }[];
  error: string | null;
  fills?: TradeFill[];
};
export type TradeFill = {
  id: string;
  venue: TradeVenue;
  symbol: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  createdAt: number;
  fee: number | null;
};
export type TradeRequest = {
  clientOrderId: string;
  venue: TradeVenue;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  notional: number;
  leverage: number;
  limitPrice?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  reduceOnly?: boolean;
  closeFraction?: number;
  newsId?: string;
};
