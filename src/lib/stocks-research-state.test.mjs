import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
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

removeDatabaseFiles();

const previousDbPath = process.env.STOCKS_RESEARCH_DB;
process.env.STOCKS_RESEARCH_DB = dbPath;

try {
  const defaultState = getStocksResearchState("NVDA", { dbPath });
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

  const saved = saveStocksResearchState({
    dbPath,
    input: {
      ticker: "nvda",
      status: "holding",
      conviction: 4,
      entryZone: "$180-$190",
      invalidation: "Breaks the 200-day moving average and fundamentals weaken.",
      nextCatalyst: "Next earnings report.",
      thesis: "Blackwell shipments and AI capital spending continue to validate demand.",
    },
  });
  assert.equal(saved.ticker, "NVDA");
  assert.equal(saved.status, "holding");
  assert.equal(saved.persisted, true);
  assert.equal(saved.conviction, 4);
  assert.ok(saved.updatedAt);

  assert.deepEqual(getStocksResearchState("NVDA", { dbPath }), saved);

  const states = getStocksResearchStates({ dbPath });
  assert.equal(states.NVDA.status, "holding");
  assert.equal(states.AMD.persisted, false);

  assertValidationError(() =>
    saveStocksResearchState({
      dbPath,
      input: { ticker: "NVDA", status: "researching" },
    }),
  );
  assertValidationError(() =>
    saveStocksResearchState({
      dbPath,
      input: { ticker: "NVDA", status: "watch", conviction: 0 },
    }),
  );
  assertValidationError(() =>
    saveStocksResearchState({
      dbPath,
      input: { ticker: "NVDA", status: "watch", conviction: 6 },
    }),
  );
  assertValidationError(() =>
    saveStocksResearchState({
      dbPath,
      input: { ticker: "UNKNOWN", status: "watch" },
    }),
  );
  assertValidationError(() =>
    saveStocksResearchState({
      dbPath,
      input: { ticker: "NVDA", status: "watch", entryZone: "x".repeat(501) },
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
