import { AppShell } from "@/components/app-shell";
import { DailyBriefPanel } from "@/components/daily-brief-panel";
import {
  getDailyInvestmentBriefHistory,
  getLatestDailyInvestmentBrief,
} from "@/lib/daily-investment-brief";

export const dynamic = "force-dynamic";

export default async function IntelPage() {
  const [snapshot, history] = await Promise.all([
    getLatestDailyInvestmentBrief(),
    getDailyInvestmentBriefHistory({ days: 15 }),
  ]);

  return (
    <AppShell
      activeNav="intel"
      subtitle="AI + 币圈投资情报站"
      mainClassName="mx-auto w-full max-w-[1500px] min-h-0 px-3 py-3 sm:px-5 lg:py-4"
    >
      <DailyBriefPanel initialSnapshot={snapshot} initialHistory={history} />
    </AppShell>
  );
}
