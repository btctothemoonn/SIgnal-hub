import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dbPath = join(
  process.cwd(),
  ".signal-hub",
  `stocks-research-state-route-test-${process.pid}.sqlite`,
);
const corruptDbPath = join(
  process.cwd(),
  ".signal-hub",
  `stocks-research-state-route-corrupt-${process.pid}.sqlite`,
);

function removeDatabaseFiles() {
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(corruptDbPath, { force: true });
  rmSync(`${corruptDbPath}-shm`, { force: true });
  rmSync(`${corruptDbPath}-wal`, { force: true });
}

function completeInput(overrides = {}) {
  return {
    ticker: "NVDA",
    status: "holding",
    conviction: 5,
    entryZone: "$180-$190",
    invalidation: "Breaks the 200-day moving average.",
    nextCatalyst: "Next earnings report.",
    thesis: "AI demand remains durable.",
    ...overrides,
  };
}

removeDatabaseFiles();

const previousDbPath = process.env.STOCKS_RESEARCH_DB;
process.env.STOCKS_RESEARCH_DB = dbPath;

try {
  const { GET, PUT } = await import("./route.ts");

  const collectionResponse = await GET(
    new Request("http://signal-hub.test/api/stocks-research-state"),
  );
  assert.equal(collectionResponse.status, 200);
  const collection = await collectionResponse.json();
  assert.equal(collection.states.NVDA.status, "watch");
  assert.equal(collection.states.NVDA.persisted, false);

  const tickerResponse = await GET(
    new Request("http://signal-hub.test/api/stocks-research-state?ticker=NVDA"),
  );
  assert.equal(tickerResponse.status, 200);
  assert.equal((await tickerResponse.json()).state.ticker, "NVDA");

  const savedResponse = await PUT(
    new Request("http://signal-hub.test/api/stocks-research-state", {
      method: "PUT",
      body: JSON.stringify(completeInput()),
      headers: { "Content-Type": "application/json" },
    }),
  );
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.equal(saved.ok, true);
  assert.equal(saved.state.status, "holding");
  assert.equal(saved.state.persisted, true);

  const persistedResponse = await GET(
    new Request("http://signal-hub.test/api/stocks-research-state?ticker=NVDA"),
  );
  assert.equal((await persistedResponse.json()).state.status, "holding");

  const validationResponse = await PUT(
    new Request("http://signal-hub.test/api/stocks-research-state", {
      method: "PUT",
      body: JSON.stringify({ ticker: "NVDA", status: "watch" }),
      headers: { "Content-Type": "application/json" },
    }),
  );
  assert.equal(validationResponse.status, 400);
  assert.equal((await validationResponse.json()).error.code, "VALIDATION_ERROR");

  writeFileSync(corruptDbPath, "not a sqlite database");
  process.env.STOCKS_RESEARCH_DB = corruptDbPath;
  const storageResponse = await GET(
    new Request("http://signal-hub.test/api/stocks-research-state"),
  );
  assert.equal(storageResponse.status, 500);
  const storageError = await storageResponse.json();
  assert.equal(storageError.error.code, "INTERNAL_ERROR");
  assert.doesNotMatch(JSON.stringify(storageError), new RegExp(corruptDbPath.replace(/[\\]/g, "\\\\")));
  assert.doesNotMatch(JSON.stringify(storageError), /stack|Error:/i);
} finally {
  if (previousDbPath === undefined) {
    delete process.env.STOCKS_RESEARCH_DB;
  } else {
    process.env.STOCKS_RESEARCH_DB = previousDbPath;
  }
  removeDatabaseFiles();
}

console.log("ok - stocks research state route behavior");
