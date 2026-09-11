import { WecomError } from "./wecom-errors.ts";
import type { WecomBriefing, WecomCaAlert, WecomHeartbeat, WecomPacket, WecomReport } from "./wecom-types.ts";

export const WECOM_MAX_BYTES = 262_144;
export const WECOM_NETWORKS = ["base", "bsc", "ethereum", "arbitrum", "polygon", "optimism", "avalanche", "solana"];
const SENSITIVE = /(?:\bsk-(?:cp-)?[a-z0-9_-]{20,}|\bAKIA[A-Z0-9]{16}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bbearer\s+[a-z0-9._~-]{16,}|(?:api[_ -]?key|secret|password|密码)\s*[:=]\s*["']?[^\s"']{8,})/i;
const REPORT_KEYS = "id revision cadence windowStart windowEnd generatedAt summary model sourceCount sourceComplete sourcesTruncated topics findings sources briefing scope sourceReferences caDiscussions caCoverage";
const ALERT_KEYS = "id revision address network groups groupCount mentionCount uniqueStatementCount duplicateCount firstSeenAt lastSeenAt triggeredAt evaluatedAt expiresAt windowSeconds thresholdGroups status notificationVersion catchup";
export const WECOM_HEARTBEAT_KEYS = "listener worker pendingReports lastError caDetector pendingAlerts lastMessageObservedAt lastCaEvaluatedAt";

function requireValue(condition: unknown, code = "payload_invalid"): asserts condition {
  if (!condition) throw new WecomError(code, code === "payload_too_large" ? 413 : 400);
}
function object<T>(value: unknown, fields: string): T {
  requireValue(value && typeof value === "object" && !Array.isArray(value));
  const expected = fields.split(" ");
  const actual = Object.keys(value);
  requireValue(actual.length === expected.length && actual.every(key => expected.includes(key)));
  return value as T;
}
function integer(value: unknown, minimum = 0): asserts value is number {
  requireValue(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum);
}
function text(value: unknown, maximum: number): asserts value is string {
  requireValue(typeof value === "string" && value.trim() && value.length <= maximum && value.isWellFormed());
  requireValue(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value));
}
export function wecomTimestamp(value: unknown): number {
  text(value, 40);
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
  requireValue(match);
  const parsed = Date.parse(value);
  requireValue(Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === match[1]);
  return parsed;
}
function instant(value: string): bigint {
  const milliseconds = wecomTimestamp(value);
  const fraction = /\.(\d{1,6})/.exec(value)?.[1] ?? "";
  return BigInt(Math.floor(milliseconds / 1000)) * BigInt(1000000) + BigInt(fraction.padEnd(6, "0"));
}
function rows<T>(value: unknown, maximum: number): T[] {
  requireValue(Array.isArray(value) && value.length <= maximum);
  return value as T[];
}
function groups(value: unknown): asserts value is string[] {
  const list = rows<string>(value, 50);
  list.forEach(group => text(group, 200));
  requireValue(new Set(list).size === list.length);
}
function scan(value: unknown) {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let visited = 0, bytes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    requireValue(item.depth <= 20 && ++visited <= 20_000);
    if (typeof item.value === "string") {
      text(item.value, WECOM_MAX_BYTES);
      bytes += Buffer.byteLength(item.value);
      requireValue(bytes <= WECOM_MAX_BYTES, "payload_too_large");
      requireValue(!SENSITIVE.test(item.value), "payload_sensitive");
    } else if (Array.isArray(item.value)) {
      requireValue(item.value.length <= 1000);
      item.value.forEach(value => pending.push({ value, depth: item.depth + 1 }));
    } else if (item.value && typeof item.value === "object") {
      const entries = Object.entries(item.value);
      requireValue(entries.length <= 100);
      for (const [key, value] of entries) { text(key, 200); pending.push({ value, depth: item.depth + 1 }); }
    } else {
      requireValue(item.value === null || typeof item.value === "boolean" || (typeof item.value === "number" && Number.isSafeInteger(item.value)));
    }
  }
}
function citations(value: unknown, known: Set<string>, used: Set<string>) {
  const refs = rows<string>(value, 5);
  for (const ref of refs) { requireValue(typeof ref === "string" && known.has(ref)); used.add(ref); }
  return refs;
}
function briefing(value: unknown, known: Set<string>, used: Set<string>) {
  const b = object<WecomBriefing>(value, "version kind quick_read projects events gaps business");
  requireValue([2, 3].includes(b.version) && ["market", "business"].includes(b.kind));
  function cited(item: unknown, fields: string, allowEmpty = false) {
    const row = object<Record<string, unknown>>(item, fields + " source_message_ids");
    for (const field of fields.split(" ")) {
      text(row[field], 1200);
      // The transport preserves the Mac's 600-code-point source budget.
      requireValue(Array.from(row[field] as string).length <= 600);
    }
    const refs = citations(row.source_message_ids, known, used);
    requireValue(refs.length || (allowEmpty && ["未提供", "无有效信息"].includes(row.text as string)));
  }
  object(b.quick_read, "focus news risk");
  Object.values(b.quick_read).forEach(n => cited(n, "text", true));
  for (const p of rows<WecomBriefing["projects"][number]>(b.projects, b.version === 3 ? 24 : 8)) {
    object(p, "name chain summary catalysts latest risks data addresses source_message_ids" + (b.version === 3 ? " section views disagreement" : ""));
    if (b.version === 3) {
      requireValue(["opportunity", "subject", "market"].includes(p.section!));
      for (const view of rows(p.views, 6)) cited(view, "speaker text");
      text(p.disagreement, 1200); requireValue(Array.from(p.disagreement!).length <= 600);
    }
    const { data, addresses, ...rest } = p;
    delete rest.section; delete rest.views; delete rest.disagreement;
    cited(rest, "name chain summary catalysts latest risks");
    for (const d of rows<typeof p.data[number]>(data, 4)) {
      cited(d, "value unit source recorded_at kind"); requireValue(["历史快照", "个人预测"].includes(d.kind));
    }
    for (const a of rows<typeof p.addresses[number]>(addresses, 1)) {
      cited(a, "address chain"); requireValue(a.chain === p.chain && /^[A-Za-z0-9]{32,44}$/.test(a.address));
    }
  }
  for (const e of rows<typeof b.events[number]>(b.events, 10)) {
    if (b.version === 3) {
      object(e, "event asset nature impact pending source_message_ids section");
      requireValue(["news", "warning"].includes(e.section!));
    }
    const event = {...e}; delete event.section;
    cited(event, "event asset nature impact pending"); requireValue(["自述", "转述", "推测", "待核实"].includes(e.nature));
  }
  for (const n of rows(b.gaps, 8)) cited(n, "text");
  object(b.business, "progress notices blockers tasks");
  for (const [key, values] of Object.entries(b.business)) {
    for (const n of rows(values, 10)) cited(n, key === "tasks" ? "text owner deadline" : "text");
  }
  requireValue(b.kind !== "business" || (!b.projects.length && !b.events.length));
  requireValue(b.kind !== "market" || Object.values(b.business).every(v => !v.length));
}
function counting(c: { mentionCount: number; uniqueStatementCount: number; duplicateCount: number; groups: string[] }) {
  [c.mentionCount, c.uniqueStatementCount, c.duplicateCount].forEach(v => integer(v));
  requireValue(c.mentionCount === c.uniqueStatementCount + c.duplicateCount && c.mentionCount >= c.groups.length);
}
function report(value: unknown) {
  const r = object<WecomReport>(value, REPORT_KEYS);
  requireValue(["two_hour", "six_hour", "daily"].includes(r.cadence));
  requireValue(instant(r.windowStart) < instant(r.windowEnd)); wecomTimestamp(r.generatedAt);
  text(r.summary, 10000); text(r.model, 256); integer(r.sourceCount);
  requireValue(typeof r.sourceComplete === "boolean" && r.sourcesTruncated === (r.sourceCount > 0));
  for (const list of [r.topics, r.findings, r.sources]) rows(list, 0);
  const s = object<WecomReport["scope"]>(r.scope, "groupNames timeZone timeBasis dataCutoff frozenCount analyzedCount readableCount missingCount unknownTimeCount completeChatHistory externalVerification");
  groups(s.groupNames); requireValue(s.timeZone === "Asia/Shanghai" && s.timeBasis === "notification_observed_at");
  [s.frozenCount, s.analyzedCount, s.readableCount, s.missingCount, s.unknownTimeCount].forEach(v => integer(v));
  requireValue(s.frozenCount === r.sourceCount && s.analyzedCount === r.sourceCount && s.readableCount + s.missingCount === r.sourceCount);
  requireValue(s.unknownTimeCount <= s.readableCount && s.groupNames.length <= s.readableCount);
  requireValue(s.completeChatHistory === false && s.externalVerification === false && r.sourceComplete === (s.missingCount === 0));
  requireValue((s.dataCutoff !== null) === (s.readableCount - s.unknownTimeCount > 0));
  const cutoff = s.dataCutoff === null ? null : instant(s.dataCutoff);
  const ids = new Set<string>(), used = new Set<string>();
  let available = 0, missing = 0, unknownTime = 0;
  for (const ref of rows<WecomReport["sourceReferences"][number]>(r.sourceReferences, 500)) {
    object(ref, "id group sender observedAt available"); text(ref.id, 32);
    requireValue(/^M[0-9]{4,}$/.test(ref.id) && !ids.has(ref.id));
    requireValue(BigInt(ref.id.slice(1)) >= BigInt(1) && BigInt(ref.id.slice(1)) <= BigInt(r.sourceCount));
    ids.add(ref.id); requireValue(typeof ref.available === "boolean");
    if (ref.available) { available++; unknownTime += Number(ref.observedAt === null); }
    else { missing++; requireValue(ref.group === null && ref.sender === null && ref.observedAt === null); }
    if (ref.group !== null) { text(ref.group, 200); requireValue(s.groupNames.includes(ref.group)); }
    if (ref.sender !== null) text(ref.sender, 200);
    if (ref.observedAt !== null) requireValue(cutoff !== null && instant(ref.observedAt) <= cutoff);
  }
  requireValue(available <= s.readableCount && missing <= s.missingCount && unknownTime <= s.unknownTimeCount);
  briefing(r.briefing, ids, used);
  for (const c of rows<WecomReport["caDiscussions"][number]>(r.caDiscussions, 50)) {
    object(c, "address network groups mentionCount uniqueStatementCount duplicateCount summary sourceMessageIDs");
    text(c.address, 128); requireValue([...WECOM_NETWORKS, "unknown"].includes(c.network)); groups(c.groups);
    requireValue(c.groups.every(g => s.groupNames.includes(g)) && (c.network !== "unknown" || c.groups.length <= 1));
    counting(c); requireValue(c.mentionCount <= s.readableCount);
    if (c.summary !== null) text(c.summary, 2000);
    citations(c.sourceMessageIDs, ids, used);
  }
  requireValue(ids.size === used.size && [...ids].every(id => used.has(id)));
  const c = object<WecomReport["caCoverage"]>(r.caCoverage, "sourcesComplete totalItems exportedItems truncated");
  integer(c.totalItems); integer(c.exportedItems);
  requireValue(c.sourcesComplete === r.sourceComplete && c.exportedItems === r.caDiscussions.length && c.exportedItems <= c.totalItems && c.truncated === (c.exportedItems < c.totalItems));
}
function alert(value: unknown) {
  const a = object<WecomCaAlert>(value, ALERT_KEYS);
  text(a.address, 128); requireValue(WECOM_NETWORKS.includes(a.network)); groups(a.groups); integer(a.groupCount, 2);
  requireValue(a.groupCount === a.groups.length); counting(a);
  integer(a.windowSeconds); integer(a.thresholdGroups); integer(a.notificationVersion);
  requireValue(a.windowSeconds === 3600 && a.thresholdGroups === 2 && [0, 1].includes(a.notificationVersion) && a.notificationVersion <= a.revision);
  requireValue(typeof a.catchup === "boolean" && (!a.catchup || a.notificationVersion === 0));
  const first = instant(a.firstSeenAt), last = instant(a.lastSeenAt), triggered = instant(a.triggeredAt), evaluated = instant(a.evaluatedAt), expires = instant(a.expiresAt);
  requireValue(["active", "expired"].includes(a.status) && first <= last && last <= evaluated && triggered <= evaluated);
  requireValue(a.status !== "active" || (evaluated - BigInt(3600000000) < first && evaluated < expires));
}
export function validateWecomPacket(value: unknown): WecomPacket {
  try {
    scan(value);
    requireValue(value && typeof value === "object" && (value as WecomPacket).schemaVersion === 2, "unsupported_schema");
    const p = value as WecomPacket;
    requireValue(["report", "ca_alert", "heartbeat"].includes(p.type));
    object(p, "schemaVersion type " + (p.type === "report" ? "report" : p.type === "ca_alert" ? "alert" : "status"));
    if (p.type !== "heartbeat") {
      const item = p.type === "report" ? p.report : p.alert;
      requireValue(item && typeof item === "object"); text(item.id, 1024);
      requireValue(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(item.id)); integer(item.revision, 1);
    }
    if (p.type === "report") report(p.report);
    else if (p.type === "ca_alert") alert(p.alert);
    else {
      const s = object<WecomHeartbeat>(p.status, WECOM_HEARTBEAT_KEYS);
      for (const state of [s.listener, s.worker, s.caDetector]) requireValue(["online", "offline", "unknown"].includes(state));
      integer(s.pendingReports); integer(s.pendingAlerts);
      for (const t of [s.lastMessageObservedAt, s.lastCaEvaluatedAt]) if (t !== null) wecomTimestamp(t);
      requireValue(s.lastError === null || (typeof s.lastError === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(s.lastError)));
    }
    requireValue(Buffer.byteLength(JSON.stringify(value)) <= WECOM_MAX_BYTES, "payload_too_large");
    return p;
  } catch (error) {
    if (error instanceof WecomError) throw error;
    throw new WecomError("payload_invalid");
  }
}

export function parseWecomPacket(body: Uint8Array): WecomPacket {
  requireValue(body.byteLength <= WECOM_MAX_BYTES, "payload_too_large");
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(body);
    // JSON.parse remains the grammar parser; this token pass preserves duplicate-key evidence.
    const stack: (Set<string> | null)[] = [];
    const tokens = /"(?:\\[\s\S]|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,]/g;
    let token: RegExpExecArray | null;
    while ((token = tokens.exec(source))) {
      const value = token[0];
      if (/^-?\d/.test(value)) {
        // Python distinguishes JSON integers from floats; do not round a wire count.
        requireValue(/^-?\d+$/.test(value) && Number.isSafeInteger(Number(value)));
      } else if (value === "{" || value === "[") {
        stack.push(value === "{" ? new Set() : null); requireValue(stack.length <= 20);
      } else if (value === "}" || value === "]") stack.pop();
      else if (value.startsWith('"') && /^\s*:/.test(source.slice(tokens.lastIndex))) {
        const keys = stack[stack.length - 1];
        requireValue(keys);
        const key = JSON.parse(value) as string;
        requireValue(!keys.has(key), "duplicate_json_key"); keys.add(key);
      }
    }
    return validateWecomPacket(JSON.parse(source));
  } catch (error) {
    if (error instanceof WecomError) throw error;
    throw new WecomError("payload_invalid");
  }
}
