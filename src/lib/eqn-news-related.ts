import { open } from "node:fs/promises";
import { join } from "node:path";
import { eqnArray, eqnObject, eqnText, eqnTimestamp, eqnUrl } from "./eqn-news-core.ts";
import type { NewsDetail } from "./news-terminal-types.ts";

export function collectEqnRelatedSignals(symbols: string[], rows: unknown[], now = Date.now()): NewsDetail["signals"] {
  const patterns = symbols.slice(0, 10).filter((symbol) => /^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(symbol))
    .map((symbol) => new RegExp(`(?:^|[^A-Za-z0-9])\\$?${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^A-Za-z0-9])`));
  const found = new Map<string, NewsDetail["signals"][number]>();
  for (const value of rows.slice(0, 10000)) {
    const row = eqnObject(value); const text = eqnText(row.text, 64000); const time = eqnTimestamp(row.createdAt);
    if (!time || time < now - 86400000 || time > now || !patterns.some((pattern) => pattern.test(text))) continue;
    const url = eqnUrl(row.tweetUrl ?? row.messageUrl);
    if (url) found.set(url, { title: eqnText(text, 240), occurredAt: new Date(time).toISOString(), url });
  }
  return [...found.values()].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, 20);
}

export async function readEqnRelatedSignals(symbols: string[], now = Date.now()): Promise<NewsDetail["signals"]> {
  if (!symbols.length) return [];
  // Reuse only persisted FEED snapshots. No reader sessions, account configs or network collection.
  const paths = [process.env.TWITTER_SNAPSHOT_CACHE_FILE?.trim() || join(process.cwd(), ".signal-hub", "twitter-snapshot-cache.json"),
    process.env.TELEGRAM_SNAPSHOT_CACHE_FILE?.trim() || join(process.cwd(), ".signal-hub", "telegram-snapshot-cache.json")];
  const rows: unknown[] = [];
  for (const path of paths) {
    let file;
    try {
      file = await open(/* turbopackIgnore: true */ path, "r");
      if ((await file.stat()).size > 8_000_000) continue;
      const buffer = Buffer.alloc(8_000_001);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 8_000_000) continue;
      const data = eqnObject(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")));
      rows.push(...eqnArray(eqnObject(data.snapshot).feed).slice(0, 5000));
    } catch { /* Persisted feeds are optional and never trigger upstream collection. */ }
    finally { await file?.close(); }
  }
  return collectEqnRelatedSignals(symbols, rows, now);
}
