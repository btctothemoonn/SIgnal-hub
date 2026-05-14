import type { AlphaResearchCatalyst } from "./alpha-research-pool.ts";

export function splitStocksCatalystsForDisplay(
  catalysts: AlphaResearchCatalyst[],
  visibleGeneralLimit = 5,
) {
  const subscriptionReports = catalysts.filter(
    (catalyst) => catalyst.sourceRole === "subscription",
  );
  const generalCatalysts = catalysts.filter(
    (catalyst) => catalyst.sourceRole !== "subscription",
  );

  return {
    subscriptionReports,
    visibleCatalysts: generalCatalysts.slice(0, visibleGeneralLimit),
    hiddenCatalysts: generalCatalysts.slice(visibleGeneralLimit),
  };
}
