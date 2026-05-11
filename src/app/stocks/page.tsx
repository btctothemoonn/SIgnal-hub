import { AlphaResearchPage } from "@/components/alpha-research-page";
import { AppShell } from "@/components/app-shell";
import { ALPHA_RESEARCH_STOCKS } from "@/lib/alpha-research-pool";

export const dynamic = "force-dynamic";

export default function StocksPage() {
  const strongCount = ALPHA_RESEARCH_STOCKS.filter(
    (stock) => stock.market.dayChangePct > 2,
  ).length;
  const upcomingEarnings = ALPHA_RESEARCH_STOCKS.filter(
    (stock) => stock.market.earningsStatus === "upcoming",
  ).length;

  return (
    <AppShell
      activeNav="stocks"
      subtitle="AI / 算力链美股投研池 · 消息汇总辅助视图"
      mainClassName="mx-auto w-full max-w-[1780px] min-h-0 px-3 py-4 sm:px-5"
      statusPills={[
        {
          label: "Pool",
          status: "Mock",
          tone: "text-info",
          children: `${ALPHA_RESEARCH_STOCKS.length} tickers`,
        },
        {
          label: "Strong",
          status: "今日",
          tone: "text-success",
          children: `${strongCount} 只`,
        },
        {
          label: "Earnings",
          status: "临近",
          tone: "text-warning",
          children: `${upcomingEarnings} 只`,
        },
      ]}
    >
      <AlphaResearchPage />
    </AppShell>
  );
}
