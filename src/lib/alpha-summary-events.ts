import type { AlphaSummarySourceItem } from "./alpha-summary.ts";

export type AlphaEventSource = Pick<AlphaSummarySourceItem, "id" | "source" | "author" | "createdAt" | "link">;
export type AlphaSummaryEvent = {
  topic: string;
  title: string;
  change: string;
  impact: string;
  watch: string[];
  evidence: "opinion" | "reported" | "unverified";
  sources: AlphaEventSource[];
};
export type AlphaEventBrief = {
  version: 2;
  overview: string[];
  events: AlphaSummaryEvent[];
  disagreements: string[];
  followUps: { subject: string; trigger: string; time: string; risk: string; sources: AlphaEventSource[] }[];
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, limit = 360) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const strings = (value: unknown, limit: number) => Array.isArray(value)
  ? [...new Set(value.map(item => text(item)).filter(Boolean))].slice(0, limit) : [];

function safeLink(value: unknown) {
  try {
    const url = new URL(text(value, 2048));
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

function sourceRef(value: unknown): AlphaEventSource | null {
  const source = record(value);
  if (!text(source.id) || !text(source.author) || !["X", "Telegram", "Stocks"].includes(String(source.source))) return null;
  return {
    id: text(source.id), source: source.source as AlphaEventSource["source"],
    author: text(source.author, 120), createdAt: text(source.createdAt, 64), link: safeLink(source.link),
  };
}

function sourcesFor(value: Record<string, unknown>, items?: AlphaSummarySourceItem[]) {
  // During generation only supplied message IDs can become clickable citations.
  if (items && (!Array.isArray(value.sourceIds) || value.sourceIds.some(id => typeof id !== "string" || !items.some(item => item.id === id.trim())))) {
    throw new Error("Event summary contains invalid source references");
  }
  const sources = items
    ? strings(value.sourceIds, 8).map(id => sourceRef(items.find(item => item.id === id)))
    : (Array.isArray(value.sources) ? value.sources.slice(0, 8).map(sourceRef) : []);
  const unique = [...new Map(sources.filter((item): item is AlphaEventSource => !!item).map(item => [item.id, item])).values()];
  if (items && unique.length === 0) throw new Error("Event summary missing valid source references");
  return unique;
}

export function parseAlphaEventBrief(value: unknown, items?: AlphaSummarySourceItem[]): AlphaEventBrief | undefined {
  const brief = record(value);
  if (brief.version !== 2 || !Array.isArray(brief.overview) || !Array.isArray(brief.events) || !Array.isArray(brief.disagreements) || !Array.isArray(brief.followUps)) return undefined;
  const overview = strings(brief.overview, 3);
  if (!overview.length) return undefined;
  const events = new Map<string, AlphaSummaryEvent>();
  for (const value of brief.events.slice(0, 12)) {
    const raw = record(value);
    const title = text(raw.title, 160);
    const topic = text(raw.topic, 80);
    const change = text(raw.change);
    if (!title || !change) {
      if (items) throw new Error("Event summary missing title or change");
      continue;
    }
    const sources = sourcesFor(raw, items);
    if (!sources.length) continue;
    const event: AlphaSummaryEvent = {
      topic, title, change, impact: text(raw.impact), watch: strings(raw.watch, 3), sources,
      evidence: raw.evidence === "opinion" || raw.evidence === "reported" ? raw.evidence : "unverified",
    };
    const key = `${topic}:${title}`.replace(/\s+/g, "").toLowerCase();
    const previous = events.get(key);
    if (previous) {
      if (previous.change !== event.change || previous.impact !== event.impact) {
        throw new Error("Event summary has conflicting duplicate claims; consolidate them without losing disagreements");
      }
      previous.sources = [...new Map([...previous.sources, ...sources].map(source => [source.id, source])).values()].slice(0, 8);
      previous.watch = [...new Set([...previous.watch, ...event.watch])].slice(0, 3);
      if (previous.evidence !== event.evidence) previous.evidence = "unverified";
    } else events.set(key, event);
  }
  const followUps: AlphaEventBrief["followUps"] = [];
  for (const value of brief.followUps.slice(0, 6)) {
    const raw = record(value);
    const subject = text(raw.subject, 120);
    const trigger = text(raw.trigger);
    if (!subject || !trigger) {
      if (items) throw new Error("Event follow-up missing subject or trigger");
      continue;
    }
    const sources = sourcesFor(raw, items);
    if (sources.length) followUps.push({ subject, trigger, time: text(raw.time, 100), risk: text(raw.risk), sources });
  }
  return { version: 2, overview, events: [...events.values()].slice(0, 6), disagreements: strings(brief.disagreements, 4), followUps };
}
