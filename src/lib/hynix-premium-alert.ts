export const HYNIX_PREMIUM_ALERT_THRESHOLD_PCT = 50;
export const HYNIX_PREMIUM_ALERT_MIN_THRESHOLD_PCT = 0;
export const HYNIX_PREMIUM_ALERT_MAX_THRESHOLD_PCT = 300;
/** Unarmed production pair before the Web Push producer existed. */
export const HYNIX_PREMIUM_ALERT_LEGACY_THRESHOLD_PCT = 30;
export const HYNIX_PREMIUM_ALERT_PUSH_REVISION = 1;

export type HynixPremiumAlertSettings = {
  enabled: boolean;
  thresholdPct: number;
  pushRevision: number;
};

export const HYNIX_PREMIUM_ALERT_DEFAULT_SETTINGS: HynixPremiumAlertSettings = {
  enabled: true,
  thresholdPct: HYNIX_PREMIUM_ALERT_THRESHOLD_PCT,
  pushRevision: HYNIX_PREMIUM_ALERT_PUSH_REVISION,
};

export type HynixPremiumAlertCycle = {
  isOverThreshold: boolean;
  dismissed: boolean;
};

const DEFAULT_ALERT_CYCLE: HynixPremiumAlertCycle = {
  isOverThreshold: false,
  dismissed: false,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isValidHynixPremiumAlertThresholdPct(
  value: unknown,
): value is number {
  return (
    isFiniteNumber(value) &&
    value >= HYNIX_PREMIUM_ALERT_MIN_THRESHOLD_PCT &&
    value <= HYNIX_PREMIUM_ALERT_MAX_THRESHOLD_PCT
  );
}

export function isLegacyUnarmedHynixPremiumAlert(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const record = raw as Record<string, unknown>;
  if (record.pushRevision === HYNIX_PREMIUM_ALERT_PUSH_REVISION) return false;
  return (
    record.enabled === false &&
    record.thresholdPct === HYNIX_PREMIUM_ALERT_LEGACY_THRESHOLD_PCT
  );
}

export function normalizeHynixPremiumAlertSettings(
  raw: unknown,
): HynixPremiumAlertSettings {
  if (isLegacyUnarmedHynixPremiumAlert(raw)) {
    return { ...HYNIX_PREMIUM_ALERT_DEFAULT_SETTINGS };
  }
  if (!raw || typeof raw !== "object") {
    return { ...HYNIX_PREMIUM_ALERT_DEFAULT_SETTINGS };
  }
  const record = raw as Record<string, unknown>;
  const thresholdPct = isValidHynixPremiumAlertThresholdPct(
    record.thresholdPct,
  )
    ? Math.round(record.thresholdPct * 10) / 10
    : HYNIX_PREMIUM_ALERT_THRESHOLD_PCT;
  return {
    enabled:
      typeof record.enabled === "boolean"
        ? record.enabled
        : HYNIX_PREMIUM_ALERT_DEFAULT_SETTINGS.enabled,
    thresholdPct,
    pushRevision: HYNIX_PREMIUM_ALERT_PUSH_REVISION,
  };
}

function isBreached(value: unknown, thresholdPct: number) {
  return isFiniteNumber(value) && value >= thresholdPct;
}

export function nextHynixPremiumAlertCycle(
  current: HynixPremiumAlertCycle | undefined,
  premiumPct: number | null | undefined,
  thresholdPct = HYNIX_PREMIUM_ALERT_THRESHOLD_PCT,
): HynixPremiumAlertCycle {
  if (!isBreached(premiumPct, thresholdPct)) {
    return DEFAULT_ALERT_CYCLE;
  }
  if (!current?.isOverThreshold) {
    return {
      isOverThreshold: true,
      dismissed: false,
    };
  }
  return current;
}

export function dismissHynixPremiumAlertCycle(
  current: HynixPremiumAlertCycle,
): HynixPremiumAlertCycle {
  return {
    ...current,
    dismissed: true,
  };
}

export function shouldShowHynixPremiumAlert(
  current: HynixPremiumAlertCycle,
  premiumPct: number | null | undefined,
  enabled = true,
  thresholdPct = HYNIX_PREMIUM_ALERT_THRESHOLD_PCT,
) {
  return (
    enabled &&
    isBreached(premiumPct, thresholdPct) &&
    !current.dismissed
  );
}
