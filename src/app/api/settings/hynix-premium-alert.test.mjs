import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const nextServerStubUrl = `data:text/javascript,${encodeURIComponent(
  "export const NextResponse = { json(body, init) { return Response.json(body, init); } };",
)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") {
      return { url: nextServerStubUrl, shortCircuit: true };
    }

    if (specifier.startsWith("@/")) {
      return nextResolve(
        pathToFileURL(resolve(projectRoot, "src", `${specifier.slice(2)}.ts`)).href,
        context,
      );
    }

    if (specifier.startsWith(".") && !extname(specifier)) {
      const base = dirname(fileURLToPath(context.parentURL));
      for (const extension of [".ts", ".tsx", ".js"]) {
        const candidate = resolve(base, `${specifier}${extension}`);
        if (existsSync(candidate)) {
          return nextResolve(pathToFileURL(candidate).href, context);
        }
      }
    }

    return nextResolve(specifier, context);
  },
});

const originalCwd = process.cwd();
const directory = await mkdtemp(join(tmpdir(), "signal-hub-hynix-alert-route-"));

try {
  process.chdir(directory);
  await mkdir(".signal-hub", { recursive: true });
  const route = await import(
    `${pathToFileURL(resolve(projectRoot, "src/app/api/settings/route.ts")).href}?hynix-alert=${Date.now()}`
  );

  const response = await route.POST(
    new Request("http://signal-hub.test/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "hynixPremiumAlert.set",
        enabled: false,
        thresholdPct: 42.5,
      }),
    }),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.config.hynixPremiumAlert, {
    enabled: false,
    thresholdPct: 42.5,
  });

  const persisted = JSON.parse(
    await readFile(join(".signal-hub", "runtime-config.json"), "utf8"),
  );
  assert.deepEqual(persisted.hynixPremiumAlert, {
    enabled: false,
    thresholdPct: 42.5,
  });

  const invalidResponse = await route.POST(
    new Request("http://signal-hub.test/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "hynixPremiumAlert.set",
        enabled: true,
        thresholdPct: 300.1,
      }),
    }),
  );
  assert.equal(invalidResponse.status, 400);
} finally {
  process.chdir(originalCwd);
  await rm(directory, { recursive: true, force: true });
}

console.log("ok - settings API persists Hynix premium alert settings");
