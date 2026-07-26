import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ALPHA_RESEARCH_STOCK_UNIVERSE } from "./alpha-research-pool.ts";
import { getRuntimeDataPath } from "./runtime-storage.ts";

type EnvLike = Record<string, string | undefined>;
type DbRow = Record<string, unknown>;

export type StocksResearchStatus = "watch" | "waiting" | "holding" | "avoid";

export type StocksResearchState = {
  ticker: string;
  status: StocksResearchStatus;
  conviction: number | null;
  entryZone: string;
  invalidation: string;
  nextCatalyst: string;
  thesis: string;
  updatedAt: string | null;
  persisted: boolean;
};

export type StocksResearchStateInput = {
  ticker: string;
  status: StocksResearchStatus;
  conviction: number | null;
  entryZone: string;
  invalidation: string;
  nextCatalyst: string;
  thesis: string;
};

export class StocksResearchStateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StocksResearchStateValidationError";
  }
}

const STATUSES = new Set<StocksResearchStatus>([
  "watch",
  "waiting",
  "holding",
  "avoid",
]);
const STOCK_TICKERS = new Set(ALPHA_RESEARCH_STOCK_UNIVERSE);

function normalizeTicker(value: unknown): string {
  if (typeof value !== "string") {
    throw new StocksResearchStateValidationError("Ticker is required.");
  }
  const ticker = value.trim().toUpperCase();
  if (!STOCK_TICKERS.has(ticker)) {
    throw new StocksResearchStateValidationError("Ticker is not in the research pool.");
  }
  return ticker;
}

function normalizeStatus(value: unknown): StocksResearchStatus {
  if (typeof value !== "string" || !STATUSES.has(value as StocksResearchStatus)) {
    throw new StocksResearchStateValidationError("Status is invalid.");
  }
  return value as StocksResearchStatus;
}

function normalizeConviction(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 5
  ) {
    throw new StocksResearchStateValidationError(
      "Conviction must be an integer from 1 to 5.",
    );
  }
  return value;
}

function normalizeText(value: unknown, field: string, maxLength: number): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") {
    throw new StocksResearchStateValidationError(`${field} must be text.`);
  }
  if (value.length > maxLength) {
    throw new StocksResearchStateValidationError(
      `${field} must be ${maxLength} characters or fewer.`,
    );
  }
  return value;
}

function defaultState(ticker: string): StocksResearchState {
  return {
    ticker,
    status: "watch",
    conviction: null,
    entryZone: "",
    invalidation: "",
    nextCatalyst: "",
    thesis: "",
    updatedAt: null,
    persisted: false,
  };
}

function stateFromRow(row: DbRow): StocksResearchState {
  const ticker = normalizeTicker(row.ticker);
  return {
    ticker,
    status: normalizeStatus(row.status),
    conviction: normalizeConviction(row.conviction),
    entryZone: normalizeText(row.entry_zone, "Entry zone", 500),
    invalidation: normalizeText(row.invalidation, "Invalidation", 500),
    nextCatalyst: normalizeText(row.next_catalyst, "Next catalyst", 500),
    thesis: normalizeText(row.thesis, "Thesis", 2000),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    persisted: true,
  };
}

function requiredInputValue(input: StocksResearchStateInput, field: string): unknown {
  if (!input || typeof input !== "object" || !(field in input)) {
    throw new StocksResearchStateValidationError(`${field} is required.`);
  }
  return (input as Record<string, unknown>)[field];
}

function normalizeInput(input: StocksResearchStateInput) {
  return {
    ticker: normalizeTicker(requiredInputValue(input, "ticker")),
    status: normalizeStatus(requiredInputValue(input, "status")),
    conviction: normalizeConviction(requiredInputValue(input, "conviction")),
    entryZone: normalizeText(requiredInputValue(input, "entryZone"), "Entry zone", 500),
    invalidation: normalizeText(requiredInputValue(input, "invalidation"), "Invalidation", 500),
    nextCatalyst: normalizeText(requiredInputValue(input, "nextCatalyst"), "Next catalyst", 500),
    thesis: normalizeText(requiredInputValue(input, "thesis"), "Thesis", 2000),
  };
}

function getStocksResearchDbPath(env: EnvLike = process.env): string {
  return (
    env.STOCKS_RESEARCH_DB?.trim() ||
    getRuntimeDataPath(env, "stocks-research.sqlite")
  );
}

function openStocksResearchDb(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  try {
    db.exec("pragma journal_mode = wal");
    db.exec("pragma synchronous = normal");
    db.exec("pragma busy_timeout = 5000");
    db.exec(`
      CREATE TABLE IF NOT EXISTS stocks_research_state (
        ticker TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        conviction INTEGER,
        entry_zone TEXT,
        invalidation TEXT,
        next_catalyst TEXT,
        thesis TEXT,
        updated_at TEXT NOT NULL
      );
    `);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function hasResearchStateDatabase(path: string) {
  return path === ":memory:" || existsSync(path);
}

type StoreOptions = {
  dbPath?: string;
  env?: EnvLike;
};

export function getStocksResearchStates(
  { dbPath, env = process.env }: StoreOptions = {},
): Record<string, StocksResearchState> {
  const path = dbPath ?? getStocksResearchDbPath(env);
  const states = Object.fromEntries(
    ALPHA_RESEARCH_STOCK_UNIVERSE.map((ticker) => [ticker, defaultState(ticker)]),
  ) as Record<string, StocksResearchState>;
  if (!hasResearchStateDatabase(path)) return states;

  const db = openStocksResearchDb(path);
  try {
    const rows = db.prepare("SELECT * FROM stocks_research_state").all() as DbRow[];
    for (const row of rows) {
      if (typeof row.ticker !== "string" || !STOCK_TICKERS.has(row.ticker)) {
        continue;
      }
      const state = stateFromRow(row);
      states[state.ticker] = state;
    }
    return states;
  } finally {
    db.close();
  }
}

export function getStocksResearchState(
  ticker: string,
  { dbPath, env = process.env }: StoreOptions = {},
): StocksResearchState {
  const normalizedTicker = normalizeTicker(ticker);
  const path = dbPath ?? getStocksResearchDbPath(env);
  if (!hasResearchStateDatabase(path)) return defaultState(normalizedTicker);

  const db = openStocksResearchDb(path);
  try {
    const row = db
      .prepare("SELECT * FROM stocks_research_state WHERE ticker = ?")
      .get(normalizedTicker) as DbRow | undefined;
    return row ? stateFromRow(row) : defaultState(normalizedTicker);
  } finally {
    db.close();
  }
}

export function saveStocksResearchState({
  input,
  dbPath,
  env = process.env,
}: StoreOptions & { input: StocksResearchStateInput }): StocksResearchState {
  const state = normalizeInput(input);
  const updatedAt = new Date().toISOString();
  const db = openStocksResearchDb(dbPath ?? getStocksResearchDbPath(env));
  try {
    db.prepare(
      `
        INSERT INTO stocks_research_state (
          ticker, status, conviction, entry_zone, invalidation, next_catalyst, thesis, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ticker) DO UPDATE SET
          status = excluded.status,
          conviction = excluded.conviction,
          entry_zone = excluded.entry_zone,
          invalidation = excluded.invalidation,
          next_catalyst = excluded.next_catalyst,
          thesis = excluded.thesis,
          updated_at = excluded.updated_at
      `,
    ).run(
      state.ticker,
      state.status,
      state.conviction,
      state.entryZone,
      state.invalidation,
      state.nextCatalyst,
      state.thesis,
      updatedAt,
    );
    return { ...state, updatedAt, persisted: true };
  } finally {
    db.close();
  }
}
