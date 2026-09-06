import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const directory = dirname(fileURLToPath(import.meta.url));
export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../../docs/integrations/wecom-summary/${name}.example.json`, import.meta.url), "utf8"));
}
export const now = Date.parse("2026-09-06T00:30:20.000Z");
export function status(overrides = {}) {
  return { ...fixture("heartbeat").status, configured: true, connection: "online", lastSeenAt: new Date(now).toISOString(), lastReportAt: null, ...overrides };
}
export function alert(id = "episode-1", overrides = {}) {
  return { ...fixture("ca-alert").alert, id, firstReceivedAt: "2026-09-06T00:30:15.000Z", syncedAt: "2026-09-06T00:30:15.000Z", effectiveStatus: "active", delayed: false, ...overrides };
}
export function reports(items = [fixture("report").report], nextCursor = null) {
  return { items: items.map(({ id, cadence, windowStart, windowEnd, generatedAt, summary, model, sourceCount, sourceComplete, sourcesTruncated }) => ({ id, cadence, windowStart, windowEnd, generatedAt, summary, model, sourceCount, sourceComplete, sourcesTruncated, syncedAt: "2026-09-06T02:06:00.000Z" })), nextCursor, status: status() };
}
export function alerts(items = [alert()], overrides = {}) {
  return { items, nextCursor: null, status: status(), total: items.length, truncated: false, ...overrides };
}
export const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
export function harness() {
  let time = now;
  let next = 0;
  const timers = new Map();
  const requests = [];
  const redirects = [];
  let respond = (url) => url.includes("/status") ? status() : url.includes("ca-alerts") ? alerts() : reports();
  const runtime = {
    now: () => time,
    setTimeout: (fn, delay) => { timers.set(++next, { fn, at: time + delay }); return next; },
    clearTimeout: (id) => timers.delete(id),
    onUnauthorized: () => redirects.push("/login"),
    fetch: async (url, options) => {
      requests.push({ url, options });
      const result = await respond(url, options);
      return result instanceof Response ? result : new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
    },
  };
  return {
    runtime, requests, redirects, timers,
    respond: (fn) => { respond = fn; },
    async tick(ms) {
      const end = time + ms;
      for (;;) {
        const entry = [...timers].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        time = entry[1].at;
        timers.delete(entry[0]);
        entry[1].fn();
        await flush();
      }
      time = end;
      await flush();
    },
  };
}
export function textContent(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return (node?.children ?? []).map(textContent).join("");
}
export async function compileComponents(extra = {}) {
  const files = [];
  const imports = new Map();
  const suffix = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const names = ["wecom-ui", "wecom-status", "wecom-ca-alerts", "wecom-report-detail", "wecom-panel"];
  for (const name of names) imports.set(`./${name}`, `./${name}.runtime-${suffix}.mjs`);
  try {
    for (const name of names) {
      const path = join(directory, `${name}.tsx`);
      if (!existsSync(path)) continue;
      let output = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
      for (const [from, to] of imports) output = output.replaceAll(`"${from}"`, `"${to}"`);
      output = output.replaceAll('"./wecom-session"', '"./wecom-session.ts"');
      for (const [from, to] of Object.entries(extra)) output = output.replaceAll(`"${from}"`, `"${to}"`);
      const target = join(directory, imports.get(`./${name}`));
      writeFileSync(target, output);
      files.push(target);
    }
    return { load: (name) => import(pathToFileURL(join(directory, imports.get(`./${name}`))).href), cleanup: () => files.forEach((file) => rmSync(file, { force: true })) };
  } catch (error) {
    files.forEach((file) => rmSync(file, { force: true }));
    throw error;
  }
}
