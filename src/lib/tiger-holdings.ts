import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  UsStockHoldingPosition,
  UsStockHoldingSnapshot,
} from "./us-stock-holdings";

export class TigerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TigerConfigError";
  }
}

export class TigerSdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TigerSdkError";
  }
}

export class TigerUpstreamError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "TigerUpstreamError";
    this.status = status;
  }
}

export type TigerOpenApiProperties = {
  tigerId: string;
  account: string;
  license: string;
  env: string;
  privateKey: string;
};

export type TigerEquityPoint = {
  at: string;
  netLiquidation: number;
  holdingValue: number;
  cashBalance: number;
  pnl: number;
  pnlRate?: number;
  currency: "USD";
};

export type TigerHoldingSnapshot = UsStockHoldingSnapshot & {
  source: "tiger";
  accountId: string;
  netLiquidation: number;
  cashValue: number;
  buyingPower: number | null;
  warnings: string[];
};

export type TigerHoldingData = {
  snapshot: TigerHoldingSnapshot;
  equityHistory: TigerEquityPoint[];
};

type TigerHoldingDataInput = {
  updatedAt?: string;
  accountId?: string;
  positions?: Array<UsStockHoldingPosition | null | undefined>;
  rawPositions?: unknown;
  assets?: unknown;
  analytics?: unknown;
  warnings?: string[];
};

type TigerRuntimeOptions = {
  configPath?: string;
  sdkModule?: Record<string, unknown>;
  now?: () => Date;
};

type AnyConstructor = new (...args: unknown[]) => Record<string, unknown>;

const TIGER_SDK_PACKAGE = "@tigeropenapi/tigeropen";

const THEME_BY_SYMBOL: Record<string, { theme: string; tags: string[]; name?: string }> =
  {
    ARM: { theme: "Semiconductor", tags: ["Semiconductor", "CPU", "IP"] },
    DRAM: { theme: "Memory chain", tags: ["DRAM", "HBM", "ETF"] },
    LITE: { theme: "Optical", tags: ["Optical", "AI infra"] },
    MU: { theme: "Memory chain", tags: ["DRAM", "HBM", "Memory"], name: "Micron" },
    NOK: { theme: "Optical", tags: ["Optical", "Network"], name: "Nokia" },
    PENG: { theme: "AI server", tags: ["AI server", "Infra"] },
    PLTR: { theme: "Option hedge", tags: ["PUT", "PLTR"] },
    RDDT: { theme: "Social platform", tags: ["Social", "AI data"] },
    SNDK: { theme: "Storage chain", tags: ["NAND", "SSD"], name: "Sandisk" },
    TE: { theme: "Energy", tags: ["Energy"] },
  };

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isObject(value)) return [];

  for (const key of ["items", "data", "positions", "assets", "result", "segments"]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested;
  }

  return [value];
}

function readField(source: unknown, names: string[]): unknown {
  if (!isObject(source)) return undefined;

  for (const name of names) {
    const value = source[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }

  for (const nestedName of ["contract", "security", "summary"]) {
    const nested = source[nestedName];
    if (isObject(nested)) {
      const value = readField(nested, names);
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }

  return undefined;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    if (!normalized) return 0;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function toUpperText(value: unknown): string {
  return toText(value).toUpperCase();
}

function nonZeroNumber(source: unknown, names: string[]): number {
  for (const name of names) {
    const value = toNumber(readField(source, [name]));
    if (value !== 0) return value;
  }
  return 0;
}

function firstNumber(source: unknown, names: string[]): number {
  for (const name of names) {
    const raw = readField(source, [name]);
    if (raw === undefined || raw === null || raw === "") continue;
    return toNumber(raw);
  }
  return 0;
}

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, "\n").trim();
}

export function parseTigerOpenApiProperties(
  content: string,
): TigerOpenApiProperties {
  const values = new Map<string, string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const separatorIndex = line.search(/[:=]/);
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values.set(key, value);
  }

  const privateKey =
    values.get("private_key_pk8") ||
    values.get("private_key") ||
    values.get("private_key_pk1") ||
    "";

  const parsed = {
    tigerId: values.get("tiger_id") || values.get("tigerId") || "",
    account: values.get("account") || values.get("account_id") || "",
    license: values.get("license") || "",
    env: values.get("env") || "PROD",
    privateKey: normalizePrivateKey(privateKey),
  };

  const missing = Object.entries(parsed)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new TigerConfigError(`Tiger config missing: ${missing.join(", ")}`);
  }

  return parsed;
}

export async function readTigerOpenApiProperties(
  path: string,
): Promise<TigerOpenApiProperties> {
  const content = await readFile(path, "utf8");
  return parseTigerOpenApiProperties(content);
}

export function getTigerOpenApiConfigPath(
  env: Record<string, string | undefined> = process.env,
) {
  const path = env.TIGER_OPENAPI_CONFIG_PATH?.trim();
  if (!path) {
    throw new TigerConfigError("TIGER_OPENAPI_CONFIG_PATH is not configured.");
  }
  return path;
}

function normalizeExpiry(value: string) {
  const compact = value.replace(/[^0-9]/g, "");
  if (compact.length !== 8) return "";
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}`;
}

function formatStrike(value: number) {
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
}

function parseOptionParts(raw: unknown) {
  const symbol = toUpperText(readField(raw, ["symbol", "secSymbol", "underlying"]));
  const identifier = toUpperText(
    readField(raw, ["identifier", "localSymbol", "contractCode", "name"]),
  );
  const optionText = `${symbol} ${identifier}`;
  const match = optionText.match(
    /([A-Z]{1,6})\D*(20\d{6})\D*([0-9]+(?:\.[0-9]+)?)\D*([CP]|PUT|CALL)\b/,
  );

  const underlying =
    toUpperText(readField(raw, ["underlying", "underlyingSymbol"])) ||
    match?.[1] ||
    symbol;
  const expiry =
    normalizeExpiry(toText(readField(raw, ["expiry", "expiryDate", "lastTradingDate"]))) ||
    normalizeExpiry(match?.[2] ?? "");
  const strike =
    firstNumber(raw, ["strike", "strikePrice"]) || toNumber(match?.[3] ?? 0);
  const rightText =
    toUpperText(readField(raw, ["right", "putCall", "optionType"])) ||
    (match?.[4] ?? "");
  const type: "PUT" | "CALL" = rightText.startsWith("P") ? "PUT" : "CALL";

  return { underlying, expiry, strike, type };
}

function inferPositionKind(raw: unknown): "equity" | "option" {
  const secType = toUpperText(readField(raw, ["secType", "assetType", "contractType"]));
  const name = toUpperText(readField(raw, ["name", "symbol", "identifier"]));
  if (secType.includes("OPT") || name.includes(" PUT") || name.includes(" CALL")) {
    return "option";
  }
  return "equity";
}

function normalizePositionName(raw: unknown, symbol: string, kind: "equity" | "option") {
  const explicitName = toText(readField(raw, ["name", "companyName", "description"]));
  if (explicitName && explicitName !== symbol) return explicitName;
  if (kind === "option") return `${symbol} option`;
  return THEME_BY_SYMBOL[symbol]?.name || explicitName || symbol;
}

function themeForSymbol(symbol: string, kind: "equity" | "option") {
  if (kind === "option") {
    return THEME_BY_SYMBOL[symbol]?.theme || "Options";
  }
  return THEME_BY_SYMBOL[symbol]?.theme || "US equity";
}

function tagsForSymbol(symbol: string, kind: "equity" | "option") {
  const tags = THEME_BY_SYMBOL[symbol]?.tags ?? [];
  if (kind === "option") return [...new Set(["Option", ...tags])].slice(0, 4);
  return tags.length ? tags.slice(0, 4) : ["US"];
}

export function normalizeTigerPosition(
  raw: unknown,
): UsStockHoldingPosition | null {
  if (!isObject(raw)) return null;

  const kind = inferPositionKind(raw);
  const optionParts = kind === "option" ? parseOptionParts(raw) : null;
  const baseSymbol =
    optionParts?.underlying ||
    toUpperText(readField(raw, ["symbol", "secSymbol", "ticker", "contractCode"]));
  if (!baseSymbol) return null;

  const quantity = nonZeroNumber(raw, [
    "position",
    "positionQty",
    "quantity",
    "qty",
    "currentAmount",
    "availableQty",
  ]);
  if (quantity === 0) return null;

  const marketValue =
    firstNumber(raw, [
      "marketValue",
      "market_value",
      "grossPositionValue",
      "mktVal",
      "value",
    ]) ||
    quantity *
      firstNumber(raw, ["latestPrice", "marketPrice", "currentPrice", "lastPrice"]);
  const currentPrice =
    firstNumber(raw, ["latestPrice", "marketPrice", "currentPrice", "lastPrice"]) ||
    (quantity ? marketValue / quantity : 0);
  const costBasis = firstNumber(raw, [
    "averageCost",
    "avgCost",
    "costBasis",
    "costPrice",
    "averageCostByAverage",
  ]);
  const unrealizedPnl = firstNumber(raw, [
    "unrealizedPnl",
    "unrealizedPnL",
    "unrealizedPL",
    "unrealizedProfit",
    "profit",
    "pnl",
  ]);

  const symbol =
    kind === "option" && optionParts
      ? `${optionParts.underlying} ${optionParts.expiry.replace(/-/g, "")} ${formatStrike(
          optionParts.strike,
        )}${optionParts.type[0]}`
      : baseSymbol;

  return {
    id: symbol.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    kind,
    name: normalizePositionName(raw, baseSymbol, kind),
    symbol,
    market: "US",
    quantity,
    marketValue: roundMoney(marketValue),
    currentPrice: roundMoney(currentPrice),
    costBasis: roundMoney(costBasis),
    unrealizedPnl: roundMoney(unrealizedPnl),
    theme: themeForSymbol(baseSymbol, kind),
    tags: tagsForSymbol(baseSymbol, kind),
    option:
      kind === "option" && optionParts
        ? {
            underlying: optionParts.underlying,
            type: optionParts.type,
            expiry: optionParts.expiry,
            strike: optionParts.strike,
          }
        : undefined,
  };
}

function normalizePositions(rawPositions: unknown): UsStockHoldingPosition[] {
  return asArray(rawPositions)
    .map((item) => normalizeTigerPosition(item))
    .filter((item): item is UsStockHoldingPosition => Boolean(item));
}

function normalizeAssetSource(rawAssets: unknown) {
  const assets = asArray(rawAssets);
  if (assets.length === 0) return null;
  const preferred =
    assets.find((asset) => toUpperText(readField(asset, ["currency"])) === "USD") ??
    assets[0];
  if (!isObject(preferred)) return null;

  const segment = asArray(preferred.segments).find((item) => {
    const category = toUpperText(readField(item, ["category", "segmentType"]));
    return category === "S" || category.includes("SEC");
  });

  return {
    asset: preferred,
    segment: segment && isObject(segment) ? segment : null,
  };
}

function numberFromAsset(rawAssets: unknown, names: string[]) {
  const assetSource = normalizeAssetSource(rawAssets);
  if (!assetSource) return 0;

  for (const source of [assetSource.segment, assetSource.asset]) {
    if (!source) continue;
    const value = firstNumber(source, names);
    if (value !== 0) return value;
  }

  return 0;
}

function normalizeAnalyticsPoint(raw: unknown): TigerEquityPoint | null {
  if (!isObject(raw)) return null;
  const dateText = toText(readField(raw, ["date", "time", "at", "createdAt"]));
  const at = dateText
    ? dateText.includes("T")
      ? dateText
      : `${dateText}T00:00:00.000Z`
    : "";
  if (!at) return null;

  return {
    at,
    netLiquidation: roundMoney(
      firstNumber(raw, ["netLiquidation", "netValue", "asset", "equity"]),
    ),
    holdingValue: roundMoney(
      firstNumber(raw, ["holdingValue", "grossPositionValue", "marketValue"]),
    ),
    cashBalance: roundMoney(firstNumber(raw, ["cashBalance", "cashValue", "cash"])),
    pnl: roundMoney(firstNumber(raw, ["pnl", "profit", "unrealizedPnL"])),
    pnlRate: firstNumber(raw, ["pnlRate", "profitRate", "rate"]) || undefined,
    currency: "USD",
  };
}

function normalizeAnalytics(rawAnalytics: unknown): TigerEquityPoint[] {
  return asArray(rawAnalytics)
    .map((item) => normalizeAnalyticsPoint(item))
    .filter((item): item is TigerEquityPoint => Boolean(item))
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime())
    .slice(-240);
}

export function buildTigerHoldingData({
  updatedAt = new Date().toISOString(),
  accountId = "",
  positions,
  rawPositions,
  assets,
  analytics,
  warnings = [],
}: TigerHoldingDataInput): TigerHoldingData {
  const normalizedPositions =
    positions?.filter((item): item is UsStockHoldingPosition => Boolean(item)) ??
    normalizePositions(rawPositions);
  const positionMarketValue = roundMoney(
    normalizedPositions.reduce((total, position) => total + position.marketValue, 0),
  );
  const positionPnl = roundMoney(
    normalizedPositions.reduce((total, position) => total + position.unrealizedPnl, 0),
  );
  const reportedMarketValue =
    numberFromAsset(assets, [
      "grossPositionValue",
      "marketValue",
      "stockMarketValue",
      "positionValue",
    ]) || positionMarketValue;
  const reportedPnl =
    numberFromAsset(assets, [
      "unrealizedPnL",
      "unrealizedPnl",
      "unrealizedPL",
      "unrealizedProfit",
      "pnl",
    ]) || positionPnl;
  const netLiquidation = numberFromAsset(assets, [
    "netLiquidation",
    "netLiquidationValue",
    "totalAssets",
    "asset",
  ]);
  const cashValue = numberFromAsset(assets, ["cashValue", "cash", "cashBalance"]);
  const buyingPower =
    numberFromAsset(assets, ["buyingPower", "availableFunds", "availableCash"]) ||
    null;

  const snapshot: TigerHoldingSnapshot = {
    source: "tiger",
    accountId,
    accountLabel: accountId ? `Tiger ${accountId}` : "Tiger account",
    currency: "USD",
    updatedAt,
    reportedPositionCount: normalizedPositions.length,
    reportedMarketValue: roundMoney(reportedMarketValue),
    reportedPnl: roundMoney(reportedPnl),
    positions: normalizedPositions,
    netLiquidation: roundMoney(netLiquidation),
    cashValue: roundMoney(cashValue),
    buyingPower: buyingPower === null ? null : roundMoney(buyingPower),
    warnings,
  };

  const equityHistory = normalizeAnalytics(analytics).map((point) => ({
    ...point,
    netLiquidation:
      point.netLiquidation > 0 ? point.netLiquidation : snapshot.netLiquidation,
    holdingValue:
      point.holdingValue > 0 ? point.holdingValue : snapshot.reportedMarketValue,
    cashBalance: point.cashBalance > 0 ? point.cashBalance : snapshot.cashValue,
  }));
  if (equityHistory.length === 0 && snapshot.netLiquidation > 0) {
    equityHistory.push({
      at: updatedAt,
      netLiquidation: snapshot.netLiquidation,
      holdingValue: snapshot.reportedMarketValue,
      cashBalance: snapshot.cashValue,
      pnl: snapshot.reportedPnl,
      currency: "USD",
    });
  }

  return { snapshot, equityHistory };
}

function unwrapSdkModule(moduleValue: Record<string, unknown>) {
  const values = [moduleValue];
  if (isObject(moduleValue.default)) values.push(moduleValue.default);
  return values;
}

function findSdkExport(moduleValue: Record<string, unknown>, names: string[]) {
  for (const root of unwrapSdkModule(moduleValue)) {
    for (const name of names) {
      const value = root[name];
      if (value) return value;
    }
  }
  return null;
}

async function loadTigerSdk() {
  try {
    const require = createRequire(import.meta.url);
    const runtimeResolve = new Function(
      "req",
      "specifier",
      "return req.resolve(specifier)",
    ) as (req: NodeRequire, specifier: string) => string;
    const runtimeRequire = new Function(
      "req",
      "specifier",
      "return req(specifier)",
    ) as (req: NodeRequire, specifier: string) => Record<string, unknown>;
    const packageEntry = runtimeResolve(require, TIGER_SDK_PACKAGE);
    const packageRoot = path.resolve(path.dirname(packageEntry), "../..");
    const fromCjs = (relativePath: string) =>
      runtimeRequire(require, path.join(packageRoot, "dist", "cjs", relativePath));

    return {
      ...runtimeRequire(require, packageEntry),
      ...fromCjs("config/index.js"),
      ...fromCjs("client/index.js"),
      ...fromCjs("trade/index.js"),
    };
  } catch (requireError) {
    const importRuntimeModule = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<Record<string, unknown>>;
    try {
      return await importRuntimeModule(TIGER_SDK_PACKAGE);
    } catch {
      if (
        requireError instanceof Error &&
        !requireError.message.includes("Cannot find module")
      ) {
        throw new TigerSdkError(requireError.message);
      }
    }
    throw new TigerSdkError(
      `Tiger SDK is not installed. Install ${TIGER_SDK_PACKAGE} on the server.`,
    );
  }
}

function buildClientConfig(moduleValue: Record<string, unknown>, configPath: string) {
  for (const root of unwrapSdkModule(moduleValue)) {
    for (const name of [
      "createClientConfig",
      "loadConfig",
      "loadOpenApiConfig",
      "createConfig",
    ]) {
      const loader = root[name];
      if (typeof loader === "function") {
        try {
          return loader({ propertiesFilePath: configPath });
        } catch {
          return loader(configPath);
        }
      }
    }
  }

  const ConfigClass = findSdkExport(moduleValue, [
    "TigerOpenApiConfig",
    "TigerOpenAPIConfig",
    "OpenApiConfig",
    "ClientConfig",
  ]);

  if (ConfigClass && typeof ConfigClass === "function") {
    const staticConfig = ConfigClass as {
      loadConfig?: (path: string) => unknown;
      load?: (path: string) => unknown;
      fromFile?: (path: string) => unknown;
    };
    if (typeof staticConfig.loadConfig === "function") {
      return staticConfig.loadConfig(configPath);
    }
    if (typeof staticConfig.load === "function") {
      return staticConfig.load(configPath);
    }
    if (typeof staticConfig.fromFile === "function") {
      return staticConfig.fromFile(configPath);
    }
  }

  return { configFilePath: configPath, propertiesFile: configPath };
}

function createTigerTradeClient(
  moduleValue: Record<string, unknown>,
  config: unknown,
  account: string,
) {
  const TradeClient = findSdkExport(moduleValue, ["TradeClient", "TigerTradeClient"]);
  if (typeof TradeClient !== "function") {
    throw new TigerSdkError("Tiger SDK TradeClient export was not found.");
  }
  const TradeClientCtor = TradeClient as AnyConstructor;

  const HttpClient = findSdkExport(moduleValue, ["HttpClient", "TigerHttpClient"]);
  if (typeof HttpClient === "function") {
    const HttpClientCtor = HttpClient as AnyConstructor;
    const httpClient = new HttpClientCtor(config);
    return new TradeClientCtor(httpClient, account);
  }

  try {
    return new TradeClientCtor(config, account);
  } catch {
    try {
      return new TradeClientCtor(config);
    } catch {
      // Fall through to a stable SDK error below.
    }
    throw new TigerSdkError("Unable to create Tiger TradeClient.");
  }
}

async function callClientMethod(
  client: Record<string, unknown>,
  methodNames: string[],
  attempts: unknown[][],
) {
  for (const methodName of methodNames) {
    const method = client[methodName];
    if (typeof method !== "function") continue;
    let lastError: unknown = null;
    for (const args of attempts) {
      try {
        return await method.apply(client, args);
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
  }
  throw new TigerSdkError(`Tiger SDK method not found: ${methodNames.join("/")}`);
}

function upstreamMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Tiger OpenAPI request failed.";
}

export async function getTigerHoldingData({
  configPath = getTigerOpenApiConfigPath(),
  sdkModule,
  now = () => new Date(),
}: TigerRuntimeOptions = {}): Promise<TigerHoldingData> {
  const sdk = sdkModule ?? (await loadTigerSdk());
  const parsedConfig = await readTigerOpenApiProperties(configPath);
  const config = buildClientConfig(sdk, configPath);

  const account = parsedConfig.account;
  const client = createTigerTradeClient(sdk, config, account);
  const market = "US";
  const warnings: string[] = [];
  const end = now();
  const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
  const formatDate = (date: Date) => date.toISOString().slice(0, 10);

  const readPositions = callClientMethod(
    client,
    ["getPositions", "positions"],
    [[{ account, market }], [account, market], [account], []],
  );
  const readAssets = callClientMethod(
    client,
    ["getPrimeAssets", "getAssets", "assets"],
    [
      [{ account, segment: true, marketValue: true }],
      [{ account }],
      [account],
      [],
    ],
  );
  const readAnalytics = callClientMethod(
    client,
    ["getAnalyticsAsset", "getAnalyticsAssets", "analyticsAsset"],
    [
      [
        {
          account,
          segType: "S",
          startDate: formatDate(start),
          endDate: formatDate(end),
        },
      ],
      [{ account, segType: "S" }],
      [account],
      [],
    ],
  );

  const [positionsResult, assetsResult, analyticsResult] = await Promise.allSettled([
    readPositions,
    readAssets,
    readAnalytics,
  ]);

  if (positionsResult.status === "rejected") {
    throw new TigerUpstreamError(upstreamMessage(positionsResult.reason));
  }
  if (assetsResult.status === "rejected") {
    warnings.push(`assets: ${upstreamMessage(assetsResult.reason)}`);
  }
  if (analyticsResult.status === "rejected") {
    warnings.push(`analytics: ${upstreamMessage(analyticsResult.reason)}`);
  }

  return buildTigerHoldingData({
    updatedAt: now().toISOString(),
    accountId: account,
    rawPositions: positionsResult.value,
    assets: assetsResult.status === "fulfilled" ? assetsResult.value : null,
    analytics:
      analyticsResult.status === "fulfilled" ? analyticsResult.value : null,
    warnings,
  });
}
