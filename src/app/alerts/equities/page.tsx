import { MarketFocusPage } from "@/components/market-focus-page";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AlertsPage() {
  return <MarketFocusPage market="equities" />;
}
