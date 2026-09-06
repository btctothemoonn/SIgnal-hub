import type { WecomCadence, WecomCaItem, WecomCaList, WecomReportDetail, WecomReportList, WecomSyncStatus } from "@/lib/wecom-types";

export type WecomInitial = {
  initialReports?: WecomReportList | null;
  initialAlerts?: WecomCaList | null;
  initialError?: string | null;
};
type Lane = "reports" | "reportsMore" | "active" | "history" | "historyMore" | "detail" | "status";
export type WecomState = {
  auth: "ok" | 401 | 403;
  cadence: WecomCadence;
  caMode: "active" | "history";
  reports: WecomReportList | null;
  activeAlerts: WecomCaList | null;
  caHistory: WecomCaList | null;
  status: WecomSyncStatus | null;
  selectedId: string | null;
  detail: WecomReportDetail | null;
  toasts: WecomCaItem[];
  errors: Partial<Record<Lane, string>>;
  loading: Partial<Record<Lane, boolean>>;
  now: number;
};
type Runtime = {
  fetch: (url: string, options: RequestInit) => Promise<Response>;
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (timer: number) => void;
  onUnauthorized: () => void;
};
type Flight = { controller: AbortController; timeout?: number };
const NETWORK_ERROR = "读取失败，保留本次会话上次成功结果。";

export function isWecomExpired(item: WecomCaItem, now: number) {
  return item.status === "expired" || item.effectiveStatus === "expired" || Date.parse(item.expiresAt) <= now;
}

function mergeItems<T extends { id: string }>(incoming: T[], previous: T[]) {
  const ids = new Set(incoming.map((item) => item.id));
  return [...incoming, ...previous.filter((item) => !ids.has(item.id))];
}

// One controller per mounted, authorized page. No browser persistence or shared private cache.
export class WecomSession {
  private state: WecomState;
  private listeners = new Set<() => void>();
  private flights = new Map<Lane, Flight>();
  private timers = new Map<Lane, number>();
  private seenIds = new Set<string>();
  private seenNotifications = new Set<string>();
  private running = false;
  private visible = false;
  private baseline = false;
  private reportsPaged = false;
  private historyPaged = false;
  private runtime: Runtime;

  constructor(initial: WecomInitial, runtime: Runtime) {
    this.runtime = runtime;
    this.state = {
      auth: "ok", cadence: "two_hour", caMode: "active",
      reports: initial.initialReports ?? null, activeAlerts: initial.initialAlerts ?? null,
      caHistory: null, status: initial.initialReports?.status ?? initial.initialAlerts?.status ?? null,
      selectedId: null, detail: null, toasts: [],
      errors: initial.initialError ? { reports: initial.initialError, active: initial.initialError } : {},
      loading: {}, now: 0,
    };
    for (const item of initial.initialAlerts?.items ?? []) this.remember(item);
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private update(patch: Partial<WecomState>) {
    this.state = { ...this.state, ...patch };
    if (this.state.toasts.some((item) => isWecomExpired(item, this.state.now))) {
      this.state = { ...this.state, toasts: this.state.toasts.filter((item) => !isWecomExpired(item, this.state.now)) };
    }
    this.listeners.forEach((listener) => listener());
  }

  private remember(item: WecomCaItem) {
    this.seenIds.add(item.id);
    this.seenNotifications.add(`${item.id}:${item.notificationVersion}`);
  }

  private latestStatus(candidate: WecomSyncStatus) {
    const current = this.state.status;
    if (current?.lastSeenAt && (!candidate.lastSeenAt || Date.parse(candidate.lastSeenAt) < Date.parse(current.lastSeenAt))) return current;
    return candidate;
  }

  start(visible: boolean) {
    if (this.state.auth !== "ok" || this.running) return;
    this.running = true;
    this.visible = visible;
    this.baseline = false;
    this.update({ now: this.runtime.now() });
    if (visible) this.refresh();
    else this.schedule("status", 60_000, () => this.checkAccess());
  }

  stop() {
    this.running = false;
    this.abortAll();
  }

  setVisible(visible: boolean) {
    if (this.state.auth !== "ok" || !this.running || this.visible === visible) return;
    this.visible = visible;
    this.abortAll();
    this.baseline = false;
    this.update({ toasts: [], loading: {}, now: this.runtime.now() });
    if (visible) this.refresh();
    else this.schedule("status", 60_000, () => this.checkAccess());
  }

  resume() {
    if (this.state.auth !== "ok" || !this.running) return;
    this.baseline = false;
    this.update({ toasts: [], now: this.runtime.now() });
    if (this.visible) this.refresh();
    else this.checkAccess();
  }

  refresh() {
    if (!this.running || this.state.auth !== "ok") return;
    this.checkAccess();
    if (!this.visible) return;
    this.readReports();
    this.readActive();
    if (this.state.caMode === "history") this.readHistory();
    if (this.state.selectedId) this.readDetail();
  }

  private abort(lane: Lane) {
    const timer = this.timers.get(lane);
    if (timer !== undefined) this.runtime.clearTimeout(timer);
    this.timers.delete(lane);
    const flight = this.flights.get(lane);
    if (flight) {
      flight.controller.abort();
      if (flight.timeout !== undefined) this.runtime.clearTimeout(flight.timeout);
    }
    this.flights.delete(lane);
  }

  private abortAll() {
    for (const lane of new Set([...this.timers.keys(), ...this.flights.keys()])) this.abort(lane);
  }

  private schedule(lane: Lane, delay: number, read: () => void) {
    if (!this.running || this.state.auth !== "ok" || (!this.visible && lane !== "status")) return;
    const previous = this.timers.get(lane);
    if (previous !== undefined) this.runtime.clearTimeout(previous);
    this.timers.set(lane, this.runtime.setTimeout(() => {
      this.timers.delete(lane);
      read();
    }, delay));
  }

  private revoke(auth: 401 | 403) {
    if (this.state.auth !== "ok") return;
    this.abortAll();
    this.seenIds.clear();
    this.seenNotifications.clear();
    this.baseline = false;
    this.reportsPaged = false;
    this.historyPaged = false;
    this.update({ auth, reports: null, activeAlerts: null, caHistory: null, status: null, selectedId: null, detail: null, toasts: [], errors: {}, loading: {}, cadence: "two_hour", caMode: "active" });
    if (auth === 401) this.runtime.onUnauthorized();
  }

  private async read<T>(lane: Lane, url: string, accept: (data: T) => void, repeat?: () => void) {
    if (!this.running || this.state.auth !== "ok" || this.flights.has(lane) || (!this.visible && lane !== "status")) return;
    const timer = this.timers.get(lane);
    if (timer !== undefined) this.runtime.clearTimeout(timer);
    this.timers.delete(lane);
    const flight: Flight = { controller: new AbortController() };
    this.flights.set(lane, flight);
    this.update({ loading: { ...this.state.loading, [lane]: true }, now: this.runtime.now() });
    const current = () => this.running && this.state.auth === "ok" && this.flights.get(lane) === flight;
    try {
      const response = this.runtime.fetch(url, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "manual", signal: flight.controller.signal }).then(async (result) => {
        // Auth loss is security-significant even if this selection was superseded.
        if (this.running && (result.status === 401 || result.status === 403)) this.revoke(result.status);
        if (this.running && (result.type === "opaqueredirect" || result.status === 302 || result.status === 307)) this.revoke(401);
        if (!result.ok) throw new Error("read_failed");
        return result.json() as Promise<T>;
      });
      const timeout = new Promise<never>((_, reject) => {
        flight.timeout = this.runtime.setTimeout(() => { flight.controller.abort(); reject(new Error("timeout")); }, 10_000);
      });
      const data = await Promise.race([response, timeout]);
      if (!current()) return;
      accept(data);
      const errors = { ...this.state.errors };
      delete errors[lane];
      this.update({ errors, now: this.runtime.now() });
    } catch {
      if (current()) this.update({ errors: { ...this.state.errors, [lane]: NETWORK_ERROR }, now: this.runtime.now() });
    } finally {
      if (flight.timeout !== undefined) this.runtime.clearTimeout(flight.timeout);
      if (current()) {
        this.flights.delete(lane);
        this.update({ loading: { ...this.state.loading, [lane]: false } });
        repeat?.();
      }
    }
  }

  checkAccess = () => {
    void this.read<WecomSyncStatus>("status", "/api/wecom/status", (status) => this.update({ status: this.latestStatus(status) }), () => this.schedule("status", 60_000, this.checkAccess));
  };

  private readReports = () => {
    const cadence = this.state.cadence;
    void this.read<WecomReportList>("reports", `/api/wecom/reports?cadence=${cadence}&limit=10`, (data) => {
      const old = this.state.reports;
      this.update({ reports: this.reportsPaged && old ? { ...data, items: mergeItems(data.items, old.items), nextCursor: old.nextCursor } : data, status: this.latestStatus(data.status) });
      if (this.state.selectedId) this.readDetail();
    }, () => this.schedule("reports", 60_000, this.readReports));
  };

  private readActive = () => {
    void this.read<WecomCaList>("active", "/api/wecom/ca-alerts?active=1&limit=50", (data) => {
      const now = this.runtime.now();
      const newToasts: WecomCaItem[] = [];
      for (const item of data.items) {
        const latency = Date.parse(item.firstReceivedAt) - Date.parse(item.triggeredAt);
        if (this.baseline && !this.seenIds.has(item.id) && !this.seenNotifications.has(`${item.id}:${item.notificationVersion}`) && item.notificationVersion > 0 && !item.catchup && !item.delayed && !isWecomExpired(item, now) && latency >= 0 && latency <= 60_000) newToasts.push(item);
        this.remember(item);
      }
      this.baseline = true;
      const existing = this.state.toasts.flatMap((item) => {
        const latest = data.items.find((candidate) => candidate.id === item.id);
        return latest && !isWecomExpired(latest, now) ? [latest] : [];
      });
      this.update({ activeAlerts: data, toasts: [...existing, ...newToasts].slice(-5), status: this.latestStatus(data.status) });
    }, () => this.schedule("active", 15_000, this.readActive));
  };

  setCadence(cadence: WecomCadence) {
    if (this.state.auth !== "ok" || cadence === this.state.cadence) return;
    for (const lane of ["reports", "reportsMore", "detail"] as const) this.abort(lane);
    this.reportsPaged = false;
    const errors = { ...this.state.errors };
    delete errors.reports;
    delete errors.reportsMore;
    delete errors.detail;
    this.update({ cadence, reports: null, selectedId: null, detail: null, errors, loading: { ...this.state.loading, reports: false, reportsMore: false, detail: false } });
    this.readReports();
  }

  selectReport(id: string | null) {
    if (this.state.auth !== "ok") return;
    if (id !== null && id === this.state.selectedId) { this.readDetail(); return; }
    this.abort("detail");
    const errors = { ...this.state.errors };
    delete errors.detail;
    this.update({ selectedId: id, detail: null, errors, loading: { ...this.state.loading, detail: false } });
    if (id) this.readDetail();
  }

  private readDetail = () => {
    const id = this.state.selectedId;
    if (!id) return;
    void this.read<WecomReportDetail>("detail", `/api/wecom/reports?id=${encodeURIComponent(id)}`, (detail) => {
      if (detail.report.id !== id) throw new Error("wrong_report");
      this.update({ detail });
    });
  };

  loadMoreReports() {
    const before = this.state.reports?.nextCursor;
    if (!before) return;
    void this.read<WecomReportList>("reportsMore", `/api/wecom/reports?cadence=${this.state.cadence}&limit=10&before=${encodeURIComponent(before)}`, (data) => {
      const old = this.state.reports;
      this.reportsPaged = true;
      this.update({ reports: { ...data, items: mergeItems(old?.items ?? [], data.items) }, status: this.latestStatus(data.status) });
    });
  }

  setCaMode(caMode: "active" | "history") {
    if (this.state.auth !== "ok" || caMode === this.state.caMode) return;
    this.abort("history");
    this.abort("historyMore");
    this.update({ caMode, loading: { ...this.state.loading, history: false, historyMore: false } });
    if (caMode === "history") this.readHistory();
  }

  private readHistory = () => {
    void this.read<WecomCaList>("history", "/api/wecom/ca-alerts?limit=10", (data) => {
      const old = this.state.caHistory;
      this.update({ caHistory: this.historyPaged && old ? { ...data, items: mergeItems(data.items, old.items), nextCursor: old.nextCursor } : data, status: this.latestStatus(data.status) });
    }, () => this.schedule("history", 15_000, this.readHistory));
  };

  loadMoreCa() {
    const before = this.state.caHistory?.nextCursor;
    if (!before || this.state.caMode !== "history") return;
    void this.read<WecomCaList>("historyMore", `/api/wecom/ca-alerts?limit=10&before=${encodeURIComponent(before)}`, (data) => {
      this.historyPaged = true;
      this.update({ caHistory: { ...data, items: mergeItems(this.state.caHistory?.items ?? [], data.items) }, status: this.latestStatus(data.status) });
    });
  }

  dismissToast(id: string) { this.update({ toasts: this.state.toasts.filter((item) => item.id !== id) }); }
}
