export type TrackedHoldingProfile = {
  id: string;
  name: string;
  source: string;
  address: string;
  dex?: string;
  externalUrl: string;
};

export type TrackedHoldingPosition = {
  coin: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  markPrice: number;
  notional: number;
  unrealizedPnl: number;
  roePercent: number;
  liquidationPrice: number | null;
  marginUsed: number;
  fundingAllTime: number;
  leverageType: string | null;
  leverageValue: number | null;
};

export type TrackedHoldingSummary = {
  accountValue: number;
  totalNotional: number;
  totalRawUsd: number;
  totalMarginUsed: number;
  withdrawable: number;
  positionCount: number;
  longNotional: number;
  shortNotional: number;
  unrealizedPnl: number;
};

export type TrackedHoldingSnapshot = {
  source: "hyperliquid";
  profile: TrackedHoldingProfile;
  updatedAt: string;
  summary: TrackedHoldingSummary;
  positions: TrackedHoldingPosition[];
};

type RawHyperliquidLeverage = {
  type?: unknown;
  value?: unknown;
};

type RawHyperliquidAssetPosition = {
  position?: {
    coin?: unknown;
    szi?: unknown;
    entryPx?: unknown;
    positionValue?: unknown;
    unrealizedPnl?: unknown;
    returnOnEquity?: unknown;
    liquidationPx?: unknown;
    marginUsed?: unknown;
    cumFunding?: {
      allTime?: unknown;
      sinceOpen?: unknown;
      sinceChange?: unknown;
    };
    leverage?: RawHyperliquidLeverage;
  };
};

type RawHyperliquidClearinghouseState = {
  marginSummary?: {
    accountValue?: unknown;
    totalNtlPos?: unknown;
    totalRawUsd?: unknown;
    totalMarginUsed?: unknown;
  };
  crossMarginSummary?: {
    accountValue?: unknown;
    totalNtlPos?: unknown;
    totalRawUsd?: unknown;
    totalMarginUsed?: unknown;
  };
  withdrawable?: unknown;
  assetPositions?: unknown;
};

export class TrackedHoldingUpstreamError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TrackedHoldingUpstreamError";
    this.status = status;
  }
}

export const TRACKED_HOLDING_PROFILES: TrackedHoldingProfile[] = [
  {
    id: "alex",
    name: "Alex",
    source: "Hyperdash / Hyperliquid",
    address: "0x87d76b68d81a3cec086e6c34afed49dbf378af8b",
    dex: "xyz",
    externalUrl:
      "https://hyperdash.com/explore/track/s7owivu6si4f0qkmzsbkj1mm?previewAddress=0x87d76b68d81a3cec086e6c34afed49dbf378af8b&previewFrom=tracking",
  },
];

function toNumber(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function getProfile(profileId: string) {
  return (
    TRACKED_HOLDING_PROFILES.find((profile) => profile.id === profileId) ??
    TRACKED_HOLDING_PROFILES[0]
  );
}

function normalizeLeverage(raw: RawHyperliquidLeverage | undefined) {
  if (!raw || typeof raw !== "object") {
    return { leverageType: null, leverageValue: null };
  }

  const value = toNumber(raw.value);
  return {
    leverageType: toText(raw.type) || null,
    leverageValue: value > 0 ? value : null,
  };
}

function normalizeCoin(raw: unknown): string {
  const coin = toText(raw);
  const [, displayCoin] = coin.split(":");
  return displayCoin || coin;
}

function normalizePosition(raw: RawHyperliquidAssetPosition) {
  const position = raw.position;
  if (!position || typeof position !== "object") return null;

  const coin = normalizeCoin(position.coin);
  const size = toNumber(position.szi);
  const notional = Math.abs(toNumber(position.positionValue));
  if (!coin || size === 0 || notional <= 0) return null;

  const { leverageType, leverageValue } = normalizeLeverage(position.leverage);
  const markPrice = Math.abs(size) > 0 ? notional / Math.abs(size) : 0;

  return {
    coin,
    side: size > 0 ? ("LONG" as const) : ("SHORT" as const),
    size,
    entryPrice: toNumber(position.entryPx),
    markPrice,
    notional,
    unrealizedPnl: toNumber(position.unrealizedPnl),
    roePercent: toNumber(position.returnOnEquity) * 100,
    liquidationPrice: toNumber(position.liquidationPx) || null,
    marginUsed: toNumber(position.marginUsed),
    fundingAllTime: toNumber(position.cumFunding?.allTime),
    leverageType,
    leverageValue,
  };
}

export function normalizeHyperliquidClearinghouseState({
  profile,
  raw,
  updatedAt = new Date().toISOString(),
}: {
  profile: TrackedHoldingProfile;
  raw: RawHyperliquidClearinghouseState;
  updatedAt?: string;
}): TrackedHoldingSnapshot {
  const summaryRaw = raw.marginSummary ?? raw.crossMarginSummary ?? {};
  const positions = Array.isArray(raw.assetPositions)
    ? raw.assetPositions
        .map((item) => normalizePosition(item as RawHyperliquidAssetPosition))
        .filter((position): position is TrackedHoldingPosition =>
          Boolean(position),
        )
    : [];
  const longNotional = positions.reduce(
    (total, position) =>
      position.side === "LONG" ? total + position.notional : total,
    0,
  );
  const shortNotional = positions.reduce(
    (total, position) =>
      position.side === "SHORT" ? total + position.notional : total,
    0,
  );
  const unrealizedPnl = positions.reduce(
    (total, position) => total + position.unrealizedPnl,
    0,
  );

  return {
    source: "hyperliquid",
    profile,
    updatedAt,
    summary: {
      accountValue: toNumber(summaryRaw.accountValue),
      totalNotional: toNumber(summaryRaw.totalNtlPos),
      totalRawUsd: toNumber(summaryRaw.totalRawUsd),
      totalMarginUsed: toNumber(summaryRaw.totalMarginUsed),
      withdrawable: toNumber(raw.withdrawable),
      positionCount: positions.length,
      longNotional,
      shortNotional,
      unrealizedPnl,
    },
    positions,
  };
}

export function getHyperliquidInfoUrl(
  env: Record<string, string | undefined> = process.env,
) {
  return env.HYPERLIQUID_INFO_URL || "https://api.hyperliquid.xyz/info";
}

export async function getTrackedHoldingSnapshot({
  profileId = "alex",
  fetcher = fetch,
  now = () => new Date().toISOString(),
}: {
  profileId?: string;
  fetcher?: typeof fetch;
  now?: () => string;
} = {}): Promise<TrackedHoldingSnapshot> {
  const profile = getProfile(profileId);
  const requestBody: {
    type: "clearinghouseState";
    user: string;
    dex?: string;
  } = {
    type: "clearinghouseState",
    user: profile.address,
  };
  if (profile.dex) requestBody.dex = profile.dex;

  const response = await fetcher(getHyperliquidInfoUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new TrackedHoldingUpstreamError(
      `Hyperliquid request failed with HTTP ${response.status}`,
      response.status,
    );
  }

  const raw = (await response.json()) as RawHyperliquidClearinghouseState;
  return normalizeHyperliquidClearinghouseState({
    profile,
    raw,
    updatedAt: now(),
  });
}
