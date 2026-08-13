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

  const { groupResearchPoolSectors } = await import(
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

  assert.deepEqual(
    groupResearchPoolSectors({
      sectors,
      stocks,
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

console.log("ok - alpha sector list keeps fixed sector and ticker order");
