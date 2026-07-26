import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  getStocksResearchState,
  getStocksResearchStates,
  saveStocksResearchState,
  StocksResearchStateValidationError,
} from "./stocks-research-state.ts";

const dbPath = join(
  process.cwd(),
  ".signal-hub",
  `stocks-research-state-test-${process.pid}.sqlite`,
);

function removeDatabaseFiles() {
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
}

function assertValidationError(callback) {
  assert.throws(
    callback,
    (error) => error instanceof StocksResearchStateValidationError,
  );
}

function completeInput(overrides = {}) {
  return {
    ticker: "NVDA",
    status: "holding",
    conviction: 4,
    entryZone: "$180-$190",
    invalidation: "Breaks the 200-day moving average and fundamentals weaken.",
    nextCatalyst: "Next earnings report.",
    thesis: "Blackwell shipments and AI capital spending continue to validate demand.",
    ...overrides,
  };
}

removeDatabaseFiles();

const previousDbPath = process.env.STOCKS_RESEARCH_DB;
process.env.STOCKS_RESEARCH_DB = dbPath;

try {
  const defaultState = getStocksResearchState("NVDA");
  assert.deepEqual(defaultState, {
    ticker: "NVDA",
    status: "watch",
    conviction: null,
    entryZone: "",
    invalidation: "",
    nextCatalyst: "",
    thesis: "",
    updatedAt: null,
    persisted: false,
  });
  assert.equal(existsSync(dbPath), false);

  const defaultStates = getStocksResearchStates();
  assert.equal(defaultStates.NVDA.persisted, false);
  assert.equal(defaultStates.AMD.persisted, false);
  assert.equal(existsSync(dbPath), false);

  const initialSaved = saveStocksResearchState({
    dbPath,
    input: completeInput({ ticker: "nvda" }),
  });
  assert.equal(initialSaved.ticker, "NVDA");
  assert.equal(initialSaved.status, "holding");
  assert.equal(initialSaved.persisted, true);
  assert.equal(initialSaved.conviction, 4);
  assert.ok(initialSaved.updatedAt);

  assert.deepEqual(getStocksResearchState("NVDA", { dbPath }), initialSaved);

  const cleared = saveStocksResearchState({
    dbPath,
    input: completeInput({
      conviction: null,
      entryZone: "",
      invalidation: "",
      nextCatalyst: "",
      thesis: "",
    }),
  });
  assert.equal(cleared.conviction, null);
  assert.equal(cleared.entryZone, "");
  assert.equal(cleared.invalidation, "");
  assert.equal(cleared.nextCatalyst, "");
  assert.equal(cleared.thesis, "");

  const saved = saveStocksResearchState({
    dbPath,
    input: completeInput({ ticker: "nvda" }),
  });

  const states = getStocksResearchStates({ dbPath });
  assert.equal(states.NVDA.status, "holding");
  assert.equal(states.AMD.persisted, false);

  const staleDb = new DatabaseSync(dbPath);
  try {
    staleDb.prepare(
      `
        INSERT INTO stocks_research_state (
          ticker, status, conviction, entry_zone, invalidation, next_catalyst, thesis, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "LEGACY",
      "watch",
      null,
      "",
      "",
      "",
      "",
      new Date().toISOString(),
    );
  } finally {
    staleDb.close();
  }
  const statesWithStaleRow = getStocksResearchStates({ dbPath });
  assert.equal(statesWithStaleRow.LEGACY, undefined);
  assert.equal(statesWithStaleRow.NVDA.status, "holding");

  for (const field of [
    "ticker",
    "status",
    "conviction",
    "entryZone",
    "invalidation",
    "nextCatalyst",
    "thesis",
  ]) {
    const partial = completeInput();
    delete partial[field];
    assertValidationError(() =>
      saveStocksResearchState({ dbPath, input: partial }),
    );
    assert.deepEqual(getStocksResearchState("NVDA", { dbPath }), saved);
  }

  assertValidationError(() =>
    saveStocksResearchState({
      dbPath,
      input: completeInput({ status: "researching" }),
    }),
  );
  assertValidationError(() =>
    saveStocksResearchState({
      dbPath,
      input: completeInput({ conviction: 0 }),
    }),
  );
  assertValidationError(() =>
    saveStocksResearchState({
      dbPath,
      input: completeInput({ conviction: 6 }),
    }),
  );
  assertValidationError(() =>
    saveStocksResearchState({
      dbPath,
      input: completeInput({ ticker: "UNKNOWN" }),
    }),
  );
  assertValidationError(() =>
    saveStocksResearchState({
      dbPath,
      input: completeInput({ entryZone: "x".repeat(501) }),
    }),
  );
} finally {
  if (previousDbPath === undefined) {
    delete process.env.STOCKS_RESEARCH_DB;
  } else {
    process.env.STOCKS_RESEARCH_DB = previousDbPath;
  }
  removeDatabaseFiles();
}

console.log("ok - stocks research state persists validated pool state");
