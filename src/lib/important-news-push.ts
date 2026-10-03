import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DailyBriefItem, DailyBriefSnapshot } from "./daily-investment-brief.ts";
import { createImportantPushOutbox } from "./important-push-outbox.ts";
import { IMPORTANT_PUSH_RULE_VERSION, isFreshPushTime } from "./important-push-policy.ts";
import type { PushEvent } from "./important-push-types.ts";

export type SourceTimeBasis = "publication" | "discovery" | "fallback";
export type ValidatedNewsSource = { sourceId: string; canonicalUrl: string; source: string; publishedAt: string | null; timeBasis: SourceTimeBasis };
export const IMPORTANT_NEWS_CATEGORIES = ["已公布的重大政策决定", "系统性市场或基础设施风险", "已证实的重大安全事故", "关键公司的重大正式公告"] as const;
export type PushAssessment = { exceptional: boolean; category: (typeof IMPORTANT_NEWS_CATEGORIES)[number] | null; fact: string; impact: string; candidateIndexes: number[] };
export const NEWS_PUSH_FRESH_MS = 12 * 60 * 60_000;
export const NEWS_PUSH_QUEUE_MS = 60 * 60_000;

export function normalizePushAssessment(value: unknown): PushAssessment | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const text = (value: unknown) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 240) : "";
  const category = IMPORTANT_NEWS_CATEGORIES.find(category => category === input.category) ?? null;
  const indexes = Array.isArray(input.candidateIndexes) && input.candidateIndexes.length <= 4 && input.candidateIndexes.length > 0 &&
    input.candidateIndexes.every(index => typeof index === "number" && Number.isInteger(index) && index > 0)
    ? [...new Set(input.candidateIndexes as number[])] : [];
  const fact = text(input.fact), impact = text(input.impact);
  return { exceptional: input.exceptional === true && Boolean(category && fact && impact && indexes.length), category, fact, impact, candidateIndexes: indexes };
}
export function newsPublicationTimeBasis(value: unknown): SourceTimeBasis {
  if (typeof value === "number") {
    const time = value < 10_000_000_000 ? value * 1000 : value;
    return Number.isFinite(time) && time > 0 && time <= 8.64e15 ? "publication" : "fallback";
  }
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) return "fallback";
  const hasClock = /\d{1,2}:\d{2}/.test(value);
  const hasTimezone = /(?:Z|GMT|UTC|[+-]\d{2}:?\d{2})\s*$/i.test(value.trim());
  return hasClock && hasTimezone ? "publication" : "discovery";
}
export function canonicalNewsPushUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch { return null; }
}
export function normalizedNewsPushTitle(title: string) {
  return title.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}
export function isTrustedNewsPushUrl(value: string, domains: string[]): boolean {
  const canonical = canonicalNewsPushUrl(value);
  if (!canonical) return false;
  const host = new URL(canonical).hostname;
  return domains.some(domain => host === domain || host.endsWith(`.${domain}`));
}
export function qualifyImportantNews(input: { item: DailyBriefItem; generatedAt: string }, nowMs: number): PushEvent | null {
  const { item, generatedAt } = input;
  const assessment = normalizePushAssessment(item.pushAssessment);
  if (item.importance !== "high" || !assessment?.exceptional || !item.pushAssessedAt ||
      !isFreshPushTime(generatedAt, nowMs, NEWS_PUSH_FRESH_MS) ||
      !isFreshPushTime(item.pushAssessedAt, nowMs, NEWS_PUSH_FRESH_MS)) return null;
  const sources = item.validatedSources ?? [];
  const publications = sources.filter(source => source.timeBasis === "publication" && source.publishedAt &&
    isFreshPushTime(source.publishedAt, nowMs, NEWS_PUSH_FRESH_MS) && source.sourceId && canonicalNewsPushUrl(source.canonicalUrl));
  if (!publications.length) return null;
  const urls = [...new Set(sources.map(source => canonicalNewsPushUrl(source.canonicalUrl)).filter((url): url is string => Boolean(url)))].sort();
  const id = `news:${createHash("sha256").update(urls.join("\n")).digest("hex").slice(0, 32)}`;
  const expiresAtMs = Date.parse(item.pushAssessedAt) + NEWS_PUSH_QUEUE_MS;
  if (expiresAtMs <= nowMs) return null;
  return { id, source: "news", episodeId: id, stage: "exceptional_news", priority: 1,
    title: item.title.slice(0, 120), body: `${assessment.fact} ${assessment.impact}`.slice(0, 320),
    target: `/intel?push=${encodeURIComponent(id)}#news-push-${encodeURIComponent(id)}`, occurredAt: item.pushAssessedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    sourcePublishedAt: new Date(Math.min(...publications.map(source => Date.parse(source.publishedAt!)))).toISOString(),
    ruleVersion: IMPORTANT_PUSH_RULE_VERSION, evidence: urls };
}
export function createImportantNewsPushStore(db: DatabaseSync) {
  const outbox = createImportantPushOutbox(db);
  db.exec(`CREATE TABLE IF NOT EXISTS important_news_push_identity (event_id TEXT PRIMARY KEY, evidence_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS important_news_push_alias (alias TEXT PRIMARY KEY, event_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS important_news_push_edition (generated_at TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL);`);
  function appendGeneratedBrief(snapshot: DailyBriefSnapshot, nowMs: number): { events: PushEvent[]; snapshot: DailyBriefSnapshot } {
    if (!snapshot.success || snapshot.status !== "generated" || snapshot.error || !snapshot.generatedAt || !snapshot.brief) return { events: [], snapshot };
    const result = structuredClone(snapshot);
    const events: PushEvent[] = [];
    db.exec("SAVEPOINT important_news_generated;");
    try {
      for (const item of result.brief!.items) {
        // Retained earlier editions carry their own assessment timestamp and cannot become new events.
        if (item.pushAssessedAt !== snapshot.generatedAt) continue;
        const event = qualifyImportantNews({ item, generatedAt: snapshot.generatedAt }, nowMs);
        if (!event) continue;
        const aliases = [...event.evidence.map(url => `url:${url}`), `title:${normalizedNewsPushTitle(item.title)}`];
        let existingId: string | null = null;
        for (const alias of aliases) {
          const match = db.prepare("SELECT event_id FROM important_news_push_alias WHERE alias=?").get(alias);
          if (match) { existingId = String(match.event_id); break; }
        }
        item.pushEventId = existingId ?? event.id;
        if (!existingId) {
          db.prepare("INSERT INTO important_news_push_identity(event_id,evidence_json) VALUES (?,?)").run(event.id, JSON.stringify({ item, generatedAt: snapshot.generatedAt }));
          outbox.appendEvent(event); events.push(event);
        }
        for (const alias of aliases) db.prepare("INSERT OR IGNORE INTO important_news_push_alias(alias,event_id) VALUES (?,?)").run(alias, item.pushEventId);
      }
      if (events.length) db.prepare('INSERT OR IGNORE INTO important_news_push_edition(generated_at,snapshot_json) VALUES (?,?)')
        .run(snapshot.generatedAt, JSON.stringify(result));
      db.exec("RELEASE important_news_generated;");
      return { events, snapshot: result };
    } catch (error) {
      db.exec("ROLLBACK TO important_news_generated; RELEASE important_news_generated;");
      throw error;
    }
  }
  function readEvidence(eventId: string): { item: DailyBriefItem; generatedAt: string } | null {
    const row = db.prepare("SELECT evidence_json FROM important_news_push_identity WHERE event_id=?").get(eventId);
    return row ? JSON.parse(String(row.evidence_json)) as { item: DailyBriefItem; generatedAt: string } : null;
  }
  function readSnapshot(eventId: string): DailyBriefSnapshot | null {
    const evidence = readEvidence(eventId);
    if (!evidence) return null;
    const row = db.prepare('SELECT snapshot_json FROM important_news_push_edition WHERE generated_at=?').get(evidence.generatedAt);
    return row ? JSON.parse(String(row.snapshot_json)) as DailyBriefSnapshot : null;
  }
  return { appendGeneratedBrief, readAfter: outbox.readAfter, readEvidence, readSnapshot, getBaseline: () => ({ lastSequence: outbox.getBaseline().lastSequence }) };
}
