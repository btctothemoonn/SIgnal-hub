import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  if (specifier.startsWith("@/")) return nextResolve(pathToFileURL(resolve(process.cwd(), "src", `${specifier.slice(2)}.ts`)).href, context);
  if (specifier.startsWith(".") && !extname(specifier)) {
    const path = resolve(dirname(fileURLToPath(context.parentURL)), `${specifier}.ts`);
    if (existsSync(path)) return nextResolve(pathToFileURL(path).href, context);
  }
  return nextResolve(specifier, context);
} });
process.env.TWITTER_TOKEN = "retained-token";
process.env.TWITTER_CONNECTOR_ENABLED = "false";
process.env.X_HYBRID_ENABLED = "true";
globalThis.fetch = () => { throw new Error("retired backfill must not call any upstream"); };
const { POST } = await import("./route.ts");
const response = await POST(new Request("http://localhost/api/x/hybrid-backfill", { method: "POST", body: "{}" }));
assert.equal(response.status, 410);
assert.deepEqual(await response.json(), { success: false, error: "6551 补缺已停用。" });
console.log("ok - retired 6551 backfill rejects calls before reading data or requesting upstreams");
