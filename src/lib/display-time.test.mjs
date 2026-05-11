import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function importTs(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

const now = new Date("2026-04-26T12:30:00+08:00");

await test("formatDisplayTime shows today with time", async () => {
  const { formatDisplayTime } = await importTs("./display-time.ts");

  assert.equal(
    formatDisplayTime("2026-04-26T08:05:00+08:00", now),
    "今天 08:05",
  );
});

await test("formatDisplayTime shows yesterday with time", async () => {
  const { formatDisplayTime } = await importTs("./display-time.ts");

  assert.equal(
    formatDisplayTime("2026-04-25T23:45:00+08:00", now),
    "昨天 23:45",
  );
});

await test("formatDisplayTime shows date for older messages", async () => {
  const { formatDisplayTime } = await importTs("./display-time.ts");

  assert.equal(
    formatDisplayTime("2026-04-24T07:09:00+08:00", now),
    "04-24 07:09",
  );
});
