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

// This formatter intentionally uses the viewer's local time. Build fixtures in
// that same local zone instead of assuming the test host runs in UTC+8.
const now = new Date(2026, 3, 26, 12, 30);

await test("formatDisplayTime shows today with time", async () => {
  const { formatDisplayTime } = await importTs("./display-time.ts");

  assert.equal(
    formatDisplayTime(new Date(2026, 3, 26, 8, 5).toISOString(), now),
    "今天 08:05",
  );
});

await test("formatDisplayTime shows yesterday with time", async () => {
  const { formatDisplayTime } = await importTs("./display-time.ts");

  assert.equal(
    formatDisplayTime(new Date(2026, 3, 25, 23, 45).toISOString(), now),
    "昨天 23:45",
  );
});

await test("formatDisplayTime shows date for older messages", async () => {
  const { formatDisplayTime } = await importTs("./display-time.ts");

  assert.equal(
    formatDisplayTime(new Date(2026, 3, 24, 7, 9).toISOString(), now),
    "04-24 07:09",
  );
});
