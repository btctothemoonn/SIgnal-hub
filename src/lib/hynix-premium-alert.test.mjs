import assert from "node:assert/strict";
import {
  HYNIX_PREMIUM_ALERT_PUSH_REVISION,
  HYNIX_PREMIUM_ALERT_THRESHOLD_PCT,
  dismissHynixPremiumAlertCycle,
  isLegacyUnarmedHynixPremiumAlert,
  nextHynixPremiumAlertCycle,
  normalizeHynixPremiumAlertSettings,
  shouldShowHynixPremiumAlert,
} from "./hynix-premium-alert.ts";

let cycle = nextHynixPremiumAlertCycle(undefined, 49.99);
assert.equal(shouldShowHynixPremiumAlert(cycle, 49.99), false);

cycle = nextHynixPremiumAlertCycle(cycle, 50);
assert.equal(HYNIX_PREMIUM_ALERT_THRESHOLD_PCT, 50);
assert.equal(shouldShowHynixPremiumAlert(cycle, 50), true);

cycle = dismissHynixPremiumAlertCycle(cycle);
cycle = nextHynixPremiumAlertCycle(cycle, 51.5);
assert.equal(shouldShowHynixPremiumAlert(cycle, 51.5), false);

cycle = nextHynixPremiumAlertCycle(cycle, 49.5);
assert.equal(shouldShowHynixPremiumAlert(cycle, 49.5), false);

cycle = nextHynixPremiumAlertCycle(cycle, 50.2);
assert.equal(shouldShowHynixPremiumAlert(cycle, 50.2), true);
assert.equal(shouldShowHynixPremiumAlert(cycle, 50.2, false), false);
assert.equal(shouldShowHynixPremiumAlert(cycle, 50.2, true), true);

assert.equal(isLegacyUnarmedHynixPremiumAlert({ enabled: false, thresholdPct: 30 }), true);
assert.deepEqual(
  normalizeHynixPremiumAlertSettings({ enabled: false, thresholdPct: 30 }),
  { enabled: true, thresholdPct: 50, pushRevision: HYNIX_PREMIUM_ALERT_PUSH_REVISION },
);
assert.deepEqual(
  normalizeHynixPremiumAlertSettings({ enabled: false, thresholdPct: 30, pushRevision: 1 }),
  { enabled: false, thresholdPct: 30, pushRevision: 1 },
);

let customCycle = nextHynixPremiumAlertCycle(undefined, 34.9, 35);
assert.equal(
  shouldShowHynixPremiumAlert(customCycle, 34.9, true, 35),
  false,
);
customCycle = nextHynixPremiumAlertCycle(customCycle, 35, 35);
assert.equal(
  shouldShowHynixPremiumAlert(customCycle, 35, true, 35),
  true,
);
customCycle = dismissHynixPremiumAlertCycle(customCycle);
customCycle = nextHynixPremiumAlertCycle(customCycle, 36, 35);
assert.equal(
  shouldShowHynixPremiumAlert(customCycle, 36, true, 35),
  false,
);
customCycle = nextHynixPremiumAlertCycle(customCycle, 34.8, 35);
customCycle = nextHynixPremiumAlertCycle(customCycle, 35.2, 35);
assert.equal(
  shouldShowHynixPremiumAlert(customCycle, 35.2, true, 35),
  true,
);

console.log("ok - hynix premium alert cycle");
