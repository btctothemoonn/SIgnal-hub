export const HYNIX_PREMIUM_ALERT_THRESHOLD_PCT = 30;

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

function isBreached(value: unknown) {
  return (
    isFiniteNumber(value) && value >= HYNIX_PREMIUM_ALERT_THRESHOLD_PCT
  );
}

export function nextHynixPremiumAlertCycle(
  current: HynixPremiumAlertCycle | undefined,
  premiumPct: number | null | undefined,
): HynixPremiumAlertCycle {
  if (!isBreached(premiumPct)) {
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
) {
  return enabled && isBreached(premiumPct) && !current.dismissed;
}
