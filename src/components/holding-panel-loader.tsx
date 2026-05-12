"use client";

import dynamic from "next/dynamic";

const DynamicHoldingPanel = dynamic(
  () => import("@/components/holding-panel").then((mod) => mod.HoldingPanel),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {["a", "b", "c", "d", "e"].map((key) => (
          <div
            key={key}
            className="h-28 animate-pulse rounded-lg border border-line/70 bg-panel"
          />
        ))}
      </div>
    ),
  },
);

export function HoldingPanelLoader() {
  return <DynamicHoldingPanel />;
}
