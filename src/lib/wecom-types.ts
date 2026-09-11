export type WecomEnv = Record<string, string | undefined>;
export type WecomCadence = "two_hour" | "six_hour" | "daily";
export type WecomProcessState = "online" | "offline" | "unknown";
export type WecomAccess = { ownerId: string; deviceId: string };
export type WecomNote = { text: string; source_message_ids: string[] };
export type WecomBriefing = {
  version: 2 | 3;
  kind: "market" | "business";
  quick_read: { focus: WecomNote; news: WecomNote; risk: WecomNote };
  projects: {
    section?: "opportunity" | "subject" | "market"; views?: {speaker: string; text: string; source_message_ids: string[]}[]; disagreement?: string;
    name: string; chain: string; summary: string; catalysts: string; latest: string; risks: string;
    data: { value: string; unit: string; source: string; recorded_at: string; kind: "历史快照" | "个人预测"; source_message_ids: string[] }[];
    addresses: { address: string; chain: string; source_message_ids: string[] }[];
    source_message_ids: string[];
  }[];
  events: { section?: "news" | "warning"; event: string; asset: string; nature: "自述" | "转述" | "推测" | "待核实"; impact: string; pending: string; source_message_ids: string[] }[];
  gaps: WecomNote[];
  business: {
    progress: WecomNote[]; notices: WecomNote[]; blockers: WecomNote[];
    tasks: { text: string; owner: string; deadline: string; source_message_ids: string[] }[];
  };
};
export type WecomReport = {
  id: string; revision: number; cadence: WecomCadence;
  windowStart: string; windowEnd: string; generatedAt: string;
  summary: string; model: string; sourceCount: number; sourceComplete: boolean; sourcesTruncated: boolean;
  topics: never[]; findings: never[]; sources: never[];
  briefing: WecomBriefing;
  scope: {
    groupNames: string[]; timeZone: "Asia/Shanghai"; timeBasis: "notification_observed_at";
    dataCutoff: string | null; frozenCount: number; analyzedCount: number; readableCount: number;
    missingCount: number; unknownTimeCount: number; completeChatHistory: false; externalVerification: false;
  };
  sourceReferences: { id: string; group: string | null; sender: string | null; observedAt: string | null; available: boolean }[];
  caDiscussions: {
    address: string; network: string; groups: string[]; mentionCount: number;
    uniqueStatementCount: number; duplicateCount: number; summary: string | null; sourceMessageIDs: string[];
  }[];
  caCoverage: { sourcesComplete: boolean; totalItems: number; exportedItems: number; truncated: boolean };
};
export type WecomCaAlert = {
  id: string; revision: number; address: string; network: string; groups: string[]; groupCount: number;
  mentionCount: number; uniqueStatementCount: number; duplicateCount: number;
  firstSeenAt: string; lastSeenAt: string; triggeredAt: string; evaluatedAt: string; expiresAt: string;
  windowSeconds: 3600; thresholdGroups: 2; status: "active" | "expired";
  notificationVersion: number; catchup: boolean;
};
export type WecomHeartbeat = {
  listener: WecomProcessState; worker: WecomProcessState; pendingReports: number; lastError: string | null;
  caDetector: WecomProcessState; pendingAlerts: number; lastMessageObservedAt: string | null; lastCaEvaluatedAt: string | null;
};
export type WecomPacket =
  | { schemaVersion: 2; type: "report"; report: WecomReport }
  | { schemaVersion: 2; type: "ca_alert"; alert: WecomCaAlert }
  | { schemaVersion: 2; type: "heartbeat"; status: WecomHeartbeat };
export type WecomAck = { ok: true; id: string; revision: number; disposition: "stored" | "duplicate" | "stale" } | { ok: true };
export type WecomSyncStatus = WecomHeartbeat & {
  configured: boolean; connection: "waiting" | "online" | "offline";
  lastSeenAt: string | null; lastReportAt: string | null;
};
export type WecomReportListItem = Pick<WecomReport, "id" | "cadence" | "windowStart" | "windowEnd" | "generatedAt" | "summary" | "model" | "sourceCount" | "sourceComplete" | "sourcesTruncated"> & { syncedAt: string };
export type WecomReportList = { items: WecomReportListItem[]; nextCursor: string | null; status: WecomSyncStatus };
export type WecomReportDetail = { report: WecomReport; syncedAt: string };
export type WecomCaItem = WecomCaAlert & { firstReceivedAt: string; syncedAt: string; effectiveStatus: "active" | "expired"; delayed: boolean };
export type WecomCaList = { items: WecomCaItem[]; nextCursor: string | null; status: WecomSyncStatus; total?: number; truncated?: boolean };
