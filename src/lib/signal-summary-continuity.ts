import { createHash } from "node:crypto";
import type { AlphaSummaryPeriod, AlphaSummarySnapshot, AlphaSummarySourceItem } from "./alpha-summary.ts";
import {
  bindSignalSummaryEvidence,
  parseSignalSummaryEvents,
  type SignalSummaryEvent,
  type SignalSummaryEventCandidate,
  type SignalSummaryTracking,
} from "./signal-summary-events.ts";

type Period = Pick<AlphaSummaryPeriod, "audience" | "scope">;
type Previous = Pick<AlphaSummarySnapshot, "period" | "generatedAt" | "summary">;
const MAX_HISTORY = 10;
const MAX_SOURCES = 16;
const MAX_EVIDENCE_DIGESTS = MAX_SOURCES * 2;
const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "this", "that", "new", "update", "updates", "schedule", "results", "team", "announces", "announced", "company", "project", "protocol", "network", "协议", "网络", "项目", "公司", "团队", "更新"]);

function normalizedText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function tokens(text: string): Set<string> {
  const normalized = normalizedText(text);
  const words = (normalized.match(/[a-z0-9]{3,}/g) ?? []).filter((word) => !STOP_WORDS.has(word));
  for (const sequence of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
    for (let index = 0; index < sequence.length - 1; index += 1) words.push(sequence.slice(index, index + 2));
  }
  return new Set(words.filter((word) => !STOP_WORDS.has(word)));
}

function topicRelated(left: string, right: string, strong = false): boolean {
  const a = tokens(left);
  const b = tokens(right);
  const common = [...a].filter((token) => b.has(token)).length;
  // A single ticker or company is never enough to bind two events.
  return common >= 2 && common / Math.max(1, Math.min(a.size, b.size)) >= (strong ? 0.65 : 0.45);
}

function identity(event: SignalSummaryEvent, period: Period, firstSeenAt: string): string {
  const digest = createHash("sha256").update(JSON.stringify([
    period.audience, period.scope, firstSeenAt, normalizedText(event.title), [...event.sourceIds].sort(),
  ])).digest("hex").slice(0, 24);
  return `signal:${period.scope}:${digest}`;
}

function textDigest(text: string): string {
  return createHash("sha256").update(normalizedText(text)).digest("hex");
}

function bodyDigests(item: AlphaSummarySourceItem): string[] {
  return [item.text, item.translation].filter((text): text is string => Boolean(text?.trim()))
    .map(textDigest);
}

function fingerprintsBySource(ids: readonly string[], items: readonly AlphaSummarySourceItem[]): Record<string, string[]> {
  return Object.fromEntries(ids.flatMap((id) => {
    const originals = items.filter((item) => item.id === id);
    if (!originals.length || originals.some((item) => JSON.stringify(item) !== JSON.stringify(originals[0]))) return [];
    const digests = [...new Set(bodyDigests(originals[0]))];
    return digests.length ? [[id, digests]] : [];
  }));
}

function seed(event: SignalSummaryEvent, period: Period, at: string): SignalSummaryEvent {
  if (event.tracking) return event;
  return { ...event, tracking: {
    id: identity(event, period, at), state: "continuing", firstSeenAt: at, lastSeenAt: at,
    lastChangedAt: at, previousGeneratedAt: null, newSourceIds: [], note: "沿用此前摘要；早期状态未记录。",
  } };
}

export function prepareSignalSummaryPreviousEvents({ period, previous }: { period: Period; previous?: Previous | null }): SignalSummaryEvent[] {
  if (!previous?.summary || previous.period.audience !== period.audience || previous.period.scope !== period.scope) return [];
  const at = previous.generatedAt ?? previous.period.endAt;
  if (!Number.isFinite(Date.parse(at))) return [];
  const result = new Map<string, SignalSummaryEvent>();
  const active = parseSignalSummaryEvents(previous.summary.events, { includeHints: false });
  const history = parseSignalSummaryEvents(previous.summary.eventHistory, { maxEvents: MAX_HISTORY, includeHints: false });
  for (const event of [...active, ...history]) {
    if (!event.sources.length) continue;
    const entry = seed(event, period, at);
    if (!result.has(entry.tracking!.id)) result.set(entry.tracking!.id, entry);
    if (result.size === MAX_HISTORY) break;
  }
  return [...result.values()];
}

const RESTATEMENT = /\b(repost|retweet|unchanged|no (?:new |further )?(?:progress|change)|remains? (?:unchanged|the same))\b|转发|旧闻|维持不变|仍然不变|没有新进展|暂无新进展/i;
const HISTORICAL = /\b(previously|earlier|last (?:week|month|year))\b|此前|早先|曾经/i;
const UNCERTAIN = /\b(not|never|may|might|could|would|if|expected|planned|plans|rumou?r|false|untrue|fake|incorrect)\b|尚未|并未|未曾|没有|不会|不取消|未取消|未撤回|未否认|未完成|未通过|未获批|未上线|可能|或将|预计|计划|假如|如果|传闻|不实|错误/i;
const PROGRESS = /\b(completed|passed|launched|approved|released|opened|published|deployed|signed|submitted|finalized)\b|完成|通过|上线|发布|获批|批准|开放|提交|签署|启动|公布结果/i;
const REVERSAL = /\b(cancelled|canceled|withdrawn|retracted|denied|refuted|revoked)\b|取消|撤回|撤销|否认|辟谣/i;
const CLOSURE_CLAIM = /\b(cancell?ation|cancelled|canceled|withdrawal|withdrawn|revocation|revoked)\b|取消|撤回|撤销/i;
const DISPUTED_CLAIM = /\b(denied|refuted|retracted|disproved)\b|否认|辟谣|驳斥|(?:消息|报道|说法).{0,24}(?:撤回|撤销)|(?:撤回|撤销).{0,24}(?:消息|报道|说法)/i;
const CLOSURE_ACTION = /\b(cancel(?:led|ed|s|lation|ation|ling|ing)?|withdraw(?:n|s|al|ing)?|retract(?:ed|s|ion|ing)?|revok(?:e|es|ed|ing)|revocation)\b|取消|撤回|撤销/i;
const DENIAL_ACTION = /\b(den(?:ied|ies|y|ial)|refut(?:ed|es|e|ation)|disprov(?:ed|es|e))\b|否认|辟谣|驳斥/i;

function disputesClosure(text: string): boolean {
  return text.split(/[。！？!?;；\n]|\.(?:\s|$)/).some((clause) =>
    CLOSURE_CLAIM.test(clause) && DISPUTED_CLAIM.test(clause));
}

function correspondsToInvalidation(condition: string, clause: string): boolean {
  // A shared event name cannot turn denial of an unrelated allegation into
  // withdrawal of the event. Unsupported condition actions remain uncertain.
  if (CLOSURE_ACTION.test(condition)) return CLOSURE_ACTION.test(clause);
  if (DENIAL_ACTION.test(condition)) return DENIAL_ACTION.test(clause);
  return false;
}

function validProof(event: SignalSummaryEventCandidate, old: SignalSummaryEvent, items: readonly AlphaSummarySourceItem[]): "progress" | "invalidation" | null {
  const proof = event.progressProof;
  if (!proof || proof.quote.length < 8 || !event.sources.some((source) => source.id === proof.sourceId) || old.sourceIds.includes(proof.sourceId)) return null;
  // Flat-only legacy hashes cannot identify which retained originals were
  // covered. New progress stays uncertain until their supplied bodies are known.
  if (old.sourceIds.some((id) => !old.tracking?.evidenceDigestsBySource?.[id]?.length)) return null;
  const item = items.find((entry) => entry.id === proof.sourceId);
  if (!item || !(item.text.includes(proof.quote) || item.translation?.includes(proof.quote))) return null;
  const oldLatest = Math.max(...old.sources.map((entry) => Date.parse(entry.createdAt)));
  if (!Number.isFinite(oldLatest) || !Number.isFinite(Date.parse(item.createdAt)) || Date.parse(item.createdAt) <= oldLatest) return null;
  if (old.sources.some((entry) => entry.link === item.link)) return null;
  const knownDigests = new Set([...(old.tracking?.evidenceDigests ?? []), ...Object.values(old.tracking?.evidenceDigestsBySource ?? {}).flat()]);
  if (bodyDigests(item).some((digest) => knownDigests.has(digest))) return null;
  if (knownDigests.has(textDigest(proof.quote))) return null;
  if (items.some((entry) => old.sourceIds.includes(entry.id) && (entry.text.includes(proof.quote) || entry.translation?.includes(proof.quote)))) return null;
  if (normalizedText(old.change).includes(normalizedText(proof.quote)) || RESTATEMENT.test(item.text) || RESTATEMENT.test(proof.quote)) return null;
  // A short quote cannot detach an affirmative claim from the source's denial
  // or hypothetical context. Conservatively retain the card when uncertain.
  if (UNCERTAIN.test(item.text) || (item.translation && UNCERTAIN.test(item.translation))) return null;
  // Denying a cancellation report preserves the event; it does not establish
  // the cancellation itself. Include surrounding original/translation context.
  if (proof.kind === "invalidation" && (disputesClosure(item.text) || (item.translation && disputesClosure(item.translation)))) return null;
  if (proof.kind === "progress" && HISTORICAL.test(proof.quote)) return null;
  const marker = proof.kind === "invalidation" ? REVERSAL : PROGRESS;
  // Tie the actual affirmative clause to the old event, rather than a different
  // development mentioned elsewhere in a roundup. Failing closed retains it.
  const clauses = proof.quote.split(/[。！？!?;；\n]|\.(?:\s|$)/).filter(Boolean);
  const supportedClauses = clauses.filter((clause) => marker.test(clause) && !UNCERTAIN.test(clause) && !HISTORICAL.test(clause) && topicRelated(old.title, clause));
  if (!supportedClauses.length) return null;
  if (proof.kind === "invalidation" && !supportedClauses.some((clause) => old.invalidate.some((condition) =>
    correspondsToInvalidation(condition, clause) && topicRelated(condition, clause)))) return null;
  return proof.kind;
}

export function reconcileSignalSummaryContinuity({
  events, items, period, previous, generatedAt,
}: {
  events: readonly SignalSummaryEvent[];
  items: readonly AlphaSummarySourceItem[];
  period: Period;
  previous?: Previous | null;
  generatedAt: string;
}): { events: SignalSummaryEvent[]; eventHistory: SignalSummaryEvent[] } {
  const known = prepareSignalSummaryPreviousEvents({ period, previous }).map((event) => ({ ...event, tracking: {
    ...event.tracking!,
    evidenceDigestsBySource: {
      ...fingerprintsBySource(event.sourceIds, items),
      ...(event.tracking?.evidenceDigestsBySource ?? {}),
    },
  } }));
  const byId = new Map(known.map((event) => [event.tracking!.id, event]));
  const candidates = bindSignalSummaryEvidence(events, items);
  const references = new Map<string, number>();
  for (const event of candidates) if (event.previousEventId) references.set(event.previousEventId, (references.get(event.previousEventId) ?? 0) + 1);
  const used = new Set<string>();
  const previousGeneratedAt = known.length ? previous?.generatedAt ?? null : null;
  const current = candidates.map((candidate): SignalSummaryEvent => {
    let old: SignalSummaryEvent | undefined;
    if (candidate.previousEventId) {
      const referenced = byId.get(candidate.previousEventId);
      if (referenced && references.get(candidate.previousEventId) === 1 && topicRelated(referenced.title, candidate.title, true)) old = referenced;
    } else {
      const matches = known.filter((event) => event.sourceIds.some((id) => candidate.sourceIds.includes(id)) && topicRelated(event.title, candidate.title));
      if (matches.length === 1) old = matches[0];
    }
    if (old && used.has(old.tracking!.id)) old = undefined;
    if (old) used.add(old.tracking!.id);
    const proof = old ? validProof(candidate, old, items) : null;
    const sticky = old?.tracking?.state === "invalidated";
    const state: SignalSummaryTracking["state"] = sticky ? "invalidated" : !old ? "new"
      : proof === "invalidation" ? "invalidated" : proof === "progress" ? "updated" : "continuing";
    const changed = !old || (!sticky && (state === "updated" || state === "invalidated"));
    const newSourceIds = candidate.sourceIds.filter((id) => !old?.sourceIds.includes(id));
    const originals = new Map(candidate.sources.map((entry) => [entry.id, entry]));
    for (const source of old?.sources ?? []) if (!originals.has(source.id)) originals.set(source.id, source);
    const sources = [...originals.values()].slice(0, MAX_SOURCES);
    const sourceIds = [...new Set([...candidate.sourceIds, ...(old?.sourceIds ?? [])])].slice(0, MAX_SOURCES);
    const availableDigests = { ...(old?.tracking?.evidenceDigestsBySource ?? {}), ...fingerprintsBySource(candidate.sourceIds, items) };
    const evidenceDigestsBySource = Object.fromEntries(sourceIds.flatMap((id) => availableDigests[id] ? [[id, availableDigests[id]]] : []));
    const evidenceDigests = [...new Set(Object.values(evidenceDigestsBySource).flat())].slice(0, MAX_EVIDENCE_DIGESTS);
    const event = { ...candidate };
    delete event.previousEventId;
    delete event.progressProof;
    const proofQuote = proof ? candidate.progressProof!.quote.slice(0, 160) : "";
    return { ...event, sources: sources.filter((source) => sourceIds.includes(source.id)), sourceIds, tracking: {
      id: old?.tracking?.id ?? identity(candidate, period, generatedAt), state,
      firstSeenAt: old?.tracking?.firstSeenAt ?? generatedAt, lastSeenAt: generatedAt,
      lastChangedAt: changed ? generatedAt : old!.tracking!.lastChangedAt,
      previousGeneratedAt, newSourceIds, evidenceDigests, evidenceDigestsBySource,
      note: sticky ? "此前来源已明确撤回或否认；本轮材料不足以恢复判断，仍需核实。"
        : state === "invalidated" ? `新来源原文：“${proofQuote}”。对应条件已被来源否认或撤回；仍属来源陈述，需要核实。`
        : state === "updated" ? `新来源原文：“${proofQuote}”。原文包含具体进展；仍属来源陈述，需要核实。`
        : state === "new" ? "首次纳入本范围的跟踪事件。"
        : newSourceIds.length ? "补充了来源，尚无可核验的新进展，继续观察。" : "本轮未发现可核验的新进展，继续观察。",
    } };
  });
  current.sort((left, right) => Number(left.tracking!.state === "continuing") - Number(right.tracking!.state === "continuing"));
  const history = new Map<string, SignalSummaryEvent>();
  for (const event of [...current, ...known]) if (!history.has(event.tracking!.id)) history.set(event.tracking!.id, event);
  return { events: current.slice(0, 5), eventHistory: [...history.values()]
    .sort((left, right) => Date.parse(right.tracking!.lastSeenAt) - Date.parse(left.tracking!.lastSeenAt)).slice(0, MAX_HISTORY) };
}
