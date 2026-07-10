import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

function collectTests(directory, tests = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectTests(path, tests);
    } else if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
      tests.push(path);
    }
  }
  return tests;
}

const tests = ["src", "scripts"]
  .flatMap((directory) => collectTests(directory))
  .sort((left, right) => left.localeCompare(right));
const failures = [];

for (const [index, test] of tests.entries()) {
  const displayPath = relative(process.cwd(), test);
  console.log(`[test ${index + 1}/${tests.length}] ${displayPath}`);
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--experimental-transform-types",
      test,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    failures.push(displayPath);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} test file(s) failed:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\nAll ${tests.length} test files passed.`);
