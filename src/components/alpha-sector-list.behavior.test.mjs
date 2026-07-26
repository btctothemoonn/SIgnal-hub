import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const directory = dirname(fileURLToPath(import.meta.url));
const sectorListPath = join(directory, "alpha-sector-list.tsx");
const temporaryModulePath = join(
  directory,
  `alpha-sector-list.runtime-${process.pid}.mjs`,
);

try {
  const output = ts
    .transpileModule(readFileSync(sectorListPath, "utf8"), {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: sectorListPath,
    })
    .outputText.replace(
      /import \{ ALPHA_RESEARCH_SECTORS,? \} from "@\/lib\/alpha-research-pool";/,
      "const ALPHA_RESEARCH_SECTORS = [];",
    );
  writeFileSync(temporaryModulePath, output, "utf8");

  const { filterResearchPoolSectors } = await import(
    `${pathToFileURL(temporaryModulePath).href}?run=${Date.now()}`,
  );
  const sectors = [
    { id: "semiconductors", tickers: ["AMD", "INTC", "NVDA"] },
    { id: "optical", tickers: ["LITE"] },
  ];
  const stocks = [
    { ticker: "NVDA", sectorId: "semiconductors" },
    { ticker: "AMD", sectorId: "semiconductors" },
    { ticker: "INTC", sectorId: "semiconductors" },
    { ticker: "LITE", sectorId: "optical" },
  ];
  const researchStates = {
    NVDA: { status: "holding" },
    AMD: { status: "waiting" },
    LITE: { status: "avoid" },
  };

  assert.deepEqual(
    filterResearchPoolSectors({
      sectors,
      stocks,
      researchStates,
      researchStatusFilter: "watch",
    }).map((sector) => ({
      id: sector.id,
      tickers: sector.stocks.map((stock) => stock.ticker),
    })),
    [{ id: "semiconductors", tickers: ["INTC"] }],
  );
  assert.deepEqual(
    filterResearchPoolSectors({
      sectors,
      stocks,
      researchStates,
      researchStatusFilter: "holding",
    }).map((sector) => ({
      id: sector.id,
      tickers: sector.stocks.map((stock) => stock.ticker),
    })),
    [{ id: "semiconductors", tickers: ["NVDA"] }],
  );
  assert.deepEqual(
    filterResearchPoolSectors({
      sectors,
      stocks,
      researchStates,
      researchStatusFilter: "waiting",
    }).map((sector) => ({
      id: sector.id,
      tickers: sector.stocks.map((stock) => stock.ticker),
    })),
    [{ id: "semiconductors", tickers: ["AMD"] }],
  );
  assert.deepEqual(
    filterResearchPoolSectors({
      sectors,
      stocks,
      researchStates,
      researchStatusFilter: "avoid",
    }).map((sector) => ({
      id: sector.id,
      tickers: sector.stocks.map((stock) => stock.ticker),
    })),
    [{ id: "optical", tickers: ["LITE"] }],
  );
  assert.deepEqual(
    filterResearchPoolSectors({
      sectors,
      stocks,
      researchStates,
      researchStatusFilter: "all",
    }).map((sector) => ({
      id: sector.id,
      tickers: sector.stocks.map((stock) => stock.ticker),
    })),
    [
      { id: "semiconductors", tickers: ["AMD", "INTC", "NVDA"] },
      { id: "optical", tickers: ["LITE"] },
    ],
  );
} finally {
  rmSync(temporaryModulePath, { force: true });
}

console.log("ok - alpha sector list research-status filtering");
