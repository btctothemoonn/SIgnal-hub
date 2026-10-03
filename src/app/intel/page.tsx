import { AppShell } from "@/components/app-shell";
import { DailyBriefPanel } from "@/components/daily-brief-panel";
import {
  getDailyInvestmentBriefHistory,
  getDailyInvestmentBriefForPush,
  getLatestDailyInvestmentBrief,
} from "@/lib/daily-investment-brief";

export const dynamic = "force-dynamic";

export default async function IntelPage({ searchParams }: { searchParams: Promise<{ push?: string | string[] }> }) {
  const params = await searchParams;
  const pushEventId = typeof params.push === 'string' && /^news:[a-f0-9]{32}$/.test(params.push) ? params.push : undefined;
  const [snapshot, history] = await Promise.all([
    (pushEventId && getDailyInvestmentBriefForPush(pushEventId)) || getLatestDailyInvestmentBrief(),
    getDailyInvestmentBriefHistory({ days: 15 }),
  ]);

  return (
    <AppShell
      activeNav="intel"
      subtitle="AI + 币圈投资情报站"
      mainClassName="mx-auto w-full max-w-[1500px] min-h-0 px-3 py-3 sm:px-5 lg:py-4"
    >
      <DailyBriefPanel key={pushEventId ?? 'latest'} initialSnapshot={snapshot} initialHistory={history} initialPushEventId={pushEventId} />
    </AppShell>
  );
}
