import assert from "node:assert/strict";
import {
  HYNIX_PREMIUM_ALERT_THRESHOLD_PCT,
  dismissHynixPremiumAlertCycle,
  nextHynixPremiumAlertCycle,
  shouldShowHynixPremiumAlert,
} from "./hynix-premium-alert.ts";

let cycle = nextHynixPremiumAlertCycle(undefined, 29.99);
assert.equal(shouldShowHynixPremiumAlert(cycle, 29.99), false);

cycle = nextHynixPremiumAlertCycle(cycle, 30);
assert.equal(HYNIX_PREMIUM_ALERT_THRESHOLD_PCT, 30);
assert.equal(shouldShowHynixPremiumAlert(cycle, 30), true);

cycle = dismissHynixPremiumAlertCycle(cycle);
cycle = nextHynixPremiumAlertCycle(cycle, 31.5);
assert.equal(shouldShowHynixPremiumAlert(cycle, 31.5), false);

cycle = nextHynixPremiumAlertCycle(cycle, 29.5);
assert.equal(shouldShowHynixPremiumAlert(cycle, 29.5), false);

cycle = nextHynixPremiumAlertCycle(cycle, 30.2);
assert.equal(shouldShowHynixPremiumAlert(cycle, 30.2), true);
assert.equal(shouldShowHynixPremiumAlert(cycle, 30.2, false), false);
assert.equal(shouldShowHynixPremiumAlert(cycle, 30.2, true), true);

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
