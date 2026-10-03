import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { AlphaSummarySnapshot } from "./alpha-summary.ts";
import { getXPipelineConfig } from "./x-pipeline-config.ts";

type EnvLike = Record<string, string | undefined>;
type Row = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const usernameKey = (value: string) => value.trim().replace(/^@+/, "").toLowerCase();

export function xSummaryAuthorName(username: string, ...names: unknown[]): string {
  const candidates = names.map(text).filter(Boolean);
  const name = candidates.find((name) => usernameKey(name) !== usernameKey(username)) || candidates.at(-1);
  return name || `@${username.replace(/^@+/, "").trim()}`;
}

// Decorate display only: old caches keep their generation time and tracking history.
export function withSummaryAuthorNames(snapshot: AlphaSummarySnapshot, env: EnvLike): AlphaSummarySnapshot {
  const summary = snapshot.summary;
  if (!summary) return snapshot;
  const events = [...summary.events ?? [], ...summary.eventHistory ?? []];
  const telegramNames = new Set(events.flatMap((event) => event.sources.filter((source) => source.source === "Telegram").map((source) => source.author)));
  const handles = new Set([
    ...summary.stocks ?? [], ...summary.crypto ?? [],
  ].flatMap((group) => group.opinions.map((opinion) => opinion.author)));
  for (const author of summary.authors) handles.add(author.name);
  for (const event of events) {
    for (const source of event.sources) if (source.source === "X") handles.add(source.author);
  }
  const wanted = [...handles].filter((name) => /^@[A-Za-z0-9_]{1,15}$/.test(name)).map(usernameKey);
  if (!wanted.length) return snapshot;
  const names = readXNames(wanted, env);
  if (!names.size) return snapshot;
  const displayX = (author: string) => /^@[A-Za-z0-9_]{1,15}$/.test(author) ? names.get(usernameKey(author)) ?? author : author;
  const display = (author: string) => telegramNames.has(author) ? author : displayX(author);
  const groups = (value: typeof summary.stocks) => value?.map((group) => ({ ...group, opinions: group.opinions.map((opinion) => ({ ...opinion, author: display(opinion.author) })) }));
  const namedEvents = (value: typeof summary.events) => value?.map((event) => ({ ...event, sources: event.sources.map((source) => source.source === "X" ? { ...source, author: displayX(source.author) } : source) }));
  return { ...snapshot, summary: {
    ...summary,
    ...(summary.stocks ? { stocks: groups(summary.stocks) } : {}),
    ...(summary.crypto ? { crypto: groups(summary.crypto) } : {}),
    authors: summary.authors.map((author) => ({ ...author, name: display(author.name) })),
    ...(summary.events ? { events: namedEvents(summary.events) } : {}),
    ...(summary.eventHistory ? { eventHistory: namedEvents(summary.eventHistory) } : {}),
  } };
}

function readXNames(wanted: string[], env: EnvLike): Map<string, string> {
  const names = new Map<string, string>();
  const path = getXPipelineConfig(env as NodeJS.ProcessEnv).dbPath;
  if (!existsSync(path)) return names;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec("pragma query_only = on; pragma busy_timeout = 5000");
    const columns = (table: string) => new Set((db!.prepare(`pragma table_info(${table})`).all() as Row[]).map((row) => row.name));
    const accounts = columns("x_accounts");
    const feed = columns("x_feed");
    const quotes = columns("x_quoted_tweets");
    const knownDisplayHandles = new Set(accounts.has("name")
      ? (db.prepare("select username, name from x_accounts").all() as Row[])
        .filter((row) => /^@[A-Za-z0-9_]{1,15}$/.test(text(row.name)) && usernameKey(text(row.name)) !== usernameKey(text(row.username)))
        .map((row) => usernameKey(text(row.name)))
      : []);
    for (const key of new Set(wanted)) {
      // An actual display name may itself look like somebody else's handle.
      if (knownDisplayHandles.has(key)) continue;
      const account = accounts.has("name") ? db.prepare("select name from x_accounts where username_key = ?").get(key) as Row | undefined : undefined;
      if (text(account?.name) && usernameKey(text(account?.name)) !== key) {
        names.set(key, text(account?.name));
        continue;
      }
      const feedName = feed.has("display_name") ? db.prepare(`
        select display_name from x_feed where account_username_key = ?
          and trim(display_name) != '' and lower(ltrim(trim(display_name), '@')) != ?
        order by created_at desc limit 1
      `).get(key, key) as Row | undefined : undefined;
      if (text(feedName?.display_name)) {
        names.set(key, text(feedName?.display_name));
        continue;
      }
      const quoteName = quotes.has("quoted_tweet_json") ? db.prepare(`
        select json_extract(quoted_tweet_json, '$.displayName') as name from x_quoted_tweets
        where json_valid(quoted_tweet_json)
          and lower(ltrim(json_extract(quoted_tweet_json, '$.username'), '@')) = ?
          and trim(coalesce(json_extract(quoted_tweet_json, '$.displayName'), '')) != ''
        order by rowid desc limit 1
      `).get(key) as Row | undefined : undefined;
      const name = xSummaryAuthorName(key, quoteName?.name, account?.name);
      if (name !== `@${key}`) names.set(key, name);
    }
  } catch {
    // A missing/legacy pipeline database must not hide a valid cached summary.
  } finally {
    db?.close();
  }
  return names;
}
