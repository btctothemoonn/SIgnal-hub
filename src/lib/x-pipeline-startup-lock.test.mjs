import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = mkdtempSync(join(tmpdir(), "x-startup-lock-"));
const path = join(root, "pipeline.sqlite");
const holder = new DatabaseSync(path);
let timer;
try {
  holder.exec("create table fixture (id integer); begin exclusive;");
  const moduleUrl = new URL("./x-pipeline-store.ts", import.meta.url).href;
  const child = spawn(process.execPath, [
    "--experimental-strip-types", "--experimental-transform-types", "--input-type=module", "-e",
    `import { openXPipelineDb } from ${JSON.stringify(moduleUrl)};
     process.send('opening');
     const db = openXPipelineDb(${JSON.stringify(path)});
     db.close(); process.disconnect();`,
  ], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let stderr = "";
  child.stderr.on("data", (data) => { stderr += data; });
  child.on("message", () => {
    timer = setTimeout(() => holder.exec("commit"), 300);
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  assert.equal(code, 0, `startup must wait for a temporary database lock: ${stderr}`);
} finally {
  clearTimeout(timer);
  holder.close();
  rmSync(root, { recursive: true, force: true });
}
console.log("ok - X pipeline startup waits for concurrent database initialization");
