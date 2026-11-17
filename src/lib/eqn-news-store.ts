import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getRuntimeDataPath } from "./runtime-storage.ts";
import { eqnArray, eqnNumber, eqnObject, eqnText, extractEqnTextCoins, scoreEqnNews } from "./eqn-news-core.ts";
import type { EqnFeedQuery, EqnRecord } from "./eqn-news-core.ts";
import type { NewsFeed, NewsItem, NewsSourceSummary, NewsWorkerStatus } from "./news-terminal-types.ts";

export function eqnNewsEnabled(env: Record<string, string | undefined> = process.env) { return /^(1|true|yes|on)$/i.test(env.EQN_NEWS_ENABLED?.trim() || ""); }
export function eqnNewsDbPath() { return process.env.EQN_NEWS_DB?.trim() || getRuntimeDataPath(process.env, "eqn-news", "news.sqlite"); }
export const EQN_MAX_BLOCKED_SOURCES = 200;
export const eqnSourceKey = (source: string) => source.trim().toLowerCase();
export function normalizeEqnBlockedSources(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > EQN_MAX_BLOCKED_SOURCES) throw new Error("Invalid blocked sources");
  const keys = value.map((source) => {
    if (typeof source !== "string" || !source.trim() || source.length > 120) throw new Error("Invalid blocked sources");
    return eqnSourceKey(source);
  });
  return [...new Set(keys)].sort();
}
const publicItem = (record: EqnRecord): NewsItem => {
  const { id, no, publishedAt, receivedAt, channels, kind, source, sourceName, title, original, url, images, coins, digest, score } = record;
  return { id, no, publishedAt, receivedAt, channels, kind, source, sourceName, title, original, url, images, coins, digest, score };
};
const decode = (row: Record<string, unknown> | undefined): EqnRecord | null => row ? JSON.parse(String(row.json)) as EqnRecord : null;
const cursorFor = (item: NewsItem) => Buffer.from(JSON.stringify([item.publishedAt, item.id])).toString("base64url");
function decodeCursor(cursor: string) {
  try {
    if (!/^[a-zA-Z0-9_-]{1,500}$/.test(cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (!Array.isArray(value) || value.length !== 2 || !Number.isSafeInteger(value[0]) || typeof value[1] !== "string" || value[1].length > 100) throw new Error();
    return value as [number, string];
  } catch { throw new Error("Invalid news cursor"); }
}

export function openEqnNewsStore(path = eqnNewsDbPath()) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS eqn_news(id TEXT PRIMARY KEY, no INTEGER UNIQUE, published INTEGER NOT NULL, received INTEGER NOT NULL, identity TEXT NOT NULL, source TEXT NOT NULL, search TEXT NOT NULL, json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS eqn_news_time ON eqn_news(published DESC, id DESC);
    CREATE INDEX IF NOT EXISTS eqn_news_identity ON eqn_news(identity);
    CREATE TABLE IF NOT EXISTS eqn_news_coins(id TEXT NOT NULL REFERENCES eqn_news(id) ON DELETE CASCADE, symbol TEXT NOT NULL, PRIMARY KEY(id,symbol));
    CREATE INDEX IF NOT EXISTS eqn_news_coins_symbol ON eqn_news_coins(symbol,id);
    CREATE TABLE IF NOT EXISTS eqn_news_channels(id TEXT NOT NULL REFERENCES eqn_news(id) ON DELETE CASCADE, channel TEXT NOT NULL, PRIMARY KEY(id,channel));
    CREATE INDEX IF NOT EXISTS eqn_news_channels_channel ON eqn_news_channels(channel,id);
    CREATE TABLE IF NOT EXISTS eqn_news_alias(alias TEXT PRIMARY KEY, id TEXT NOT NULL REFERENCES eqn_news(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS eqn_news_state(key TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS eqn_news_revision(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO eqn_news_revision(id,revision) VALUES(1,0);
    PRAGMA foreign_keys=ON;`);
  const transaction = <T>(fn: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try { const value = fn(); db.exec("COMMIT"); return value; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const bump = () => db.prepare("UPDATE eqn_news_revision SET revision=revision+1 WHERE id=1").run();
  function getState<T = unknown>(key: string): T | null {
    const row = db.prepare("SELECT json FROM eqn_news_state WHERE key=?").get(key);
    return row ? JSON.parse(String(row.json)) as T : null;
  }
  function setState(key: string, value: unknown) {
    const json = JSON.stringify(value);
    const result = db.prepare("INSERT INTO eqn_news_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json WHERE json!=excluded.json").run(key, json);
    if (result.changes) bump();
  }
  // Shared by the web process and the worker process through SQLite, so a change applies to both immediately.
  const blockedSources = () => { try { return normalizeEqnBlockedSources(getState("blockedSources") ?? []); } catch { return []; } };
  const blockedJson = () => JSON.stringify(blockedSources());
  function sources(now = Date.now()): NewsSourceSummary[] {
    const blocked = new Set(blockedSources());
    // With MAX(), SQLite takes bare columns (source/name) from the newest row in each group.
    const rows = db.prepare(`SELECT lower(source) AS key, source, json_extract(json,'$.sourceName') AS name, MAX(published) AS last,
        COUNT(*) AS total, SUM(published>=?) AS day FROM eqn_news GROUP BY lower(source) ORDER BY total DESC, key`).all(now - 86400000);
    const summaries = rows.map((row): NewsSourceSummary => ({ source: String(row.source), name: eqnText(row.name, 160) || String(row.source),
      count: Number(row.total), count24h: Number(row.day ?? 0), lastAt: eqnNumber(row.last), blocked: blocked.has(String(row.key)) }));
    const known = new Set(summaries.map((item) => eqnSourceKey(item.source)));
    for (const key of blocked) if (!known.has(key)) summaries.push({ source: key, name: key, count: 0, count24h: 0, lastAt: null, blocked: true });
    return summaries;
  }
  function record(id: string) {
    return decode(db.prepare("SELECT json FROM eqn_news WHERE id=? OR no=? OR id=(SELECT id FROM eqn_news_alias WHERE alias=?) LIMIT 1").get(id, /^\d+$/.test(id) ? Number(id) : -1, id));
  }
  function write(item: EqnRecord) {
    db.prepare("INSERT INTO eqn_news VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET no=excluded.no,published=excluded.published,received=excluded.received,identity=excluded.identity,source=excluded.source,search=excluded.search,json=excluded.json")
      .run(item.id, item.no, item.publishedAt, item.receivedAt, item.identity, item.source, `${item.title}\n${item.original}`, JSON.stringify(item));
    db.prepare("DELETE FROM eqn_news_coins WHERE id=?").run(item.id);
    db.prepare("DELETE FROM eqn_news_channels WHERE id=?").run(item.id);
    for (const coin of item.coins) db.prepare("INSERT OR IGNORE INTO eqn_news_coins VALUES(?,?)").run(item.id, coin.symbol);
    for (const ch of item.channels) db.prepare("INSERT OR IGNORE INTO eqn_news_channels VALUES(?,?)").run(item.id, ch);
  }
  function upsert(incoming: EqnRecord) {
    if (blockedSources().includes(eqnSourceKey(incoming.source))) return false;
    return transaction(() => {
      const second = Math.floor(incoming.publishedAt / 1000) * 1000;
      const bilingualMatch = () => db.prepare("SELECT json FROM eqn_news WHERE published>=? AND published<? AND source=? COLLATE NOCASE AND (no IS NULL OR ? IS NULL) LIMIT 20")
        .all(second, second + 1000, incoming.source, incoming.no).map((row) => decode(row)!).find((candidate) =>
          !candidate.sourceUrl && !incoming.sourceUrl && [candidate.title, candidate.original].some((text) => text && [incoming.title, incoming.original].includes(text)));
      const existing = record(incoming.id) ?? decode(db.prepare("SELECT json FROM eqn_news WHERE identity=? AND (no IS NULL OR ? IS NULL OR no=?) LIMIT 1").get(incoming.identity, incoming.no, incoming.no)) ?? bilingualMatch();
      if (!existing) { write(incoming); bump(); return true; }
      const priority = (x: EqnRecord) => (x.origin === "mcp" ? 10 : x.origin === "rss" ? 5 : 0) + (x.detail ? 2 : 0);
      const richer = priority(incoming) >= priority(existing) ? incoming : existing;
      const lesser = richer === incoming ? existing : incoming;
      const merged: EqnRecord = { ...richer, id: incoming.no !== null ? incoming.id : existing.id, no: incoming.no ?? existing.no,
        receivedAt: Math.min(incoming.receivedAt, existing.receivedAt), channels: [...new Set([...existing.channels, ...incoming.channels])],
        images: richer.images.length ? richer.images : lesser.images, digest: richer.digest.length ? richer.digest : lesser.digest,
        coins: (richer.coins.length ? richer.coins : lesser.coins).map((coin) => {
          const previous = lesser.coins.find((x) => x.symbol === coin.symbol);
          return { ...coin, assetId: coin.assetId ?? previous?.assetId ?? null, marketCapAtPublish: coin.marketCapAtPublish ?? previous?.marketCapAtPublish ?? null };
        }),
      };
      merged.score = scoreEqnNews(merged);
      if (JSON.stringify(merged) === JSON.stringify(existing)) return false;
      if (existing.id !== merged.id) {
        const aliases = db.prepare("SELECT alias FROM eqn_news_alias WHERE id=?").all(existing.id).map((x) => String(x.alias));
        db.prepare("DELETE FROM eqn_news WHERE id=?").run(existing.id);
        write(merged);
        for (const alias of [existing.id, ...aliases]) db.prepare("INSERT OR REPLACE INTO eqn_news_alias VALUES(?,?)").run(alias, merged.id);
      } else write(merged);
      if (incoming.id !== merged.id) db.prepare("INSERT OR REPLACE INTO eqn_news_alias VALUES(?,?)").run(incoming.id, merged.id);
      bump(); return true;
    });
  }
  function status(now = Date.now(), enabled = eqnNewsEnabled()): NewsWorkerStatus {
    const saved = getState<NewsWorkerStatus>("status");
    if (!enabled) return { enabled: false, connected: false, updatedAt: saved?.updatedAt ?? null, lastMessageAt: saved?.lastMessageAt ?? null, error: "News worker disabled" };
    const stale = !saved?.updatedAt || now - saved.updatedAt > 90000;
    return { enabled, connected: !stale && Boolean(saved?.connected), updatedAt: saved?.updatedAt ?? null, lastMessageAt: saved?.lastMessageAt ?? null, error: stale ? "News worker heartbeat stale" : saved?.error ?? null };
  }
  function feed(query: EqnFeedQuery = {}): NewsFeed {
    const limit = Math.min(200, Math.max(1, Math.floor(query.limit || 100)));
    const conditions = ["NOT EXISTS(SELECT 1 FROM json_each(?) b WHERE b.value=lower(n.source))"];
    const args: (string | number)[] = [blockedJson()];
    if (query.before) { const [time, id] = decodeCursor(query.before); conditions.push("(n.published<? OR (n.published=? AND n.id<?))"); args.push(time, time, id); }
    if (query.channel && query.channel !== "all") { conditions.push("EXISTS(SELECT 1 FROM eqn_news_channels c WHERE c.id=n.id AND c.channel=?)"); args.push(query.channel); }
    if (query.coin) { conditions.push("EXISTS(SELECT 1 FROM eqn_news_coins c WHERE c.id=n.id AND c.symbol=?)"); args.push(query.coin.toUpperCase()); }
    if (query.source) { conditions.push("n.source=? COLLATE NOCASE"); args.push(query.source); }
    if (query.q) { conditions.push("n.search LIKE ? ESCAPE '\\'"); args.push(`%${query.q.replace(/[\\%_]/g, "\\$&")}%`); }
    const rows = db.prepare(`SELECT n.json FROM eqn_news n ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY n.published DESC,n.id DESC LIMIT ?`).all(...args, limit + 1);
    const items = rows.slice(0, limit).map((row) => publicItem(decode(row)!));
    return { items, nextCursor: rows.length > limit ? cursorFor(items[items.length - 1]) : null, status: status() };
  }
  function augment(value: unknown) {
    const row = eqnObject(value);
    const found = record(String(eqnNumber(row.no) ?? ""));
    if (!found || found.no === null) return false;
    const coins = eqnArray(row.coins).map(eqnObject);
    const updated = { ...found,
      coins: found.coins.map((coin) => {
        const extra = coins.find((x) => eqnText(x.symbol).toUpperCase() === coin.symbol);
        return { ...coin, assetId: coin.assetId ?? (eqnText(extra?.asset_id, 160) || null), marketCapAtPublish: coin.marketCapAtPublish ?? eqnNumber(extra?.mc_at_publish) };
      }),
      digest: found.digest.length ? found.digest : eqnArray(eqnObject(eqnObject(row.data).announcement_digest).points).slice(0, 20).map((x) => eqnText(x, 2000)).filter(Boolean),
    };
    updated.score = scoreEqnNews(updated);
    if (JSON.stringify(updated) === JSON.stringify(found)) return false;
    return transaction(() => { write(updated); bump(); return true; });
  }
  // One-time repair for rows stored before text pair extraction existed. Existing exchange-provided coins win.
  if (!getState("migration:textCoins:v1")) {
    transaction(() => {
      const rows = db.prepare("SELECT json FROM eqn_news WHERE json_array_length(json_extract(json,'$.coins'))=0").all().map((row) => decode(row)!);
      for (const row of rows) {
        const coins = extractEqnTextCoins(row.title, row.original).map((symbol) => ({ symbol, assetId: null, marketCapAtPublish: null }));
        if (coins.length) { const updated = { ...row, coins }; updated.score = scoreEqnNews(updated); write(updated); }
      }
      db.prepare("INSERT INTO eqn_news_state VALUES('migration:textCoins:v1','true') ON CONFLICT(key) DO NOTHING").run();
      bump();
    });
  }
  return {
    upsert, augment, getState, setState, status, feed, sources, blockedSources,
    setBlockedSources: (value: unknown) => { const blocked = normalizeEqnBlockedSources(value); setState("blockedSources", blocked); return blocked; },
    get: (id: string) => { const item = record(id); return item ? publicItem(item) : null; },
    revision: () => Number(db.prepare("SELECT revision FROM eqn_news_revision WHERE id=1").get()!.revision),
    pendingDetails: (limit = 10, now = Date.now()) => db.prepare(`
      SELECT n.json FROM eqn_news n
      LEFT JOIN eqn_news_state s ON s.key = 'detailRetry:' || n.id
      WHERE n.no IS NOT NULL AND json_extract(n.json, '$.detail') = 0
        AND COALESCE(CAST(s.json AS INTEGER), 0) <= ?
      ORDER BY n.published DESC LIMIT ?
    `).all(now, Math.min(50, limit)).map((row) => decode(row)!),
    prune(now = Date.now()) {
      return transaction(() => {
        db.prepare("DELETE FROM eqn_news WHERE published<?").run(now - 30 * 86400000);
        db.prepare("DELETE FROM eqn_news WHERE id IN (SELECT id FROM eqn_news ORDER BY published DESC,id DESC LIMIT -1 OFFSET 100000)").run();
        db.prepare("DELETE FROM eqn_news_state WHERE key LIKE 'detailRetry:%' AND substr(key,13) NOT IN (SELECT id FROM eqn_news)").run();
        bump();
      });
    },
    close: () => db.close(),
  };
}

let singleton: ReturnType<typeof openEqnNewsStore> | undefined;
export function getEqnNewsStore() { return singleton ??= openEqnNewsStore(); }
