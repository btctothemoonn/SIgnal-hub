import { AlphaResearchPage } from "@/components/alpha-research-page";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default function StocksPage() {
  return (
    <AppShell
      activeNav="stocks"
      subtitle="AI / 算力链美股投研池 · 消息汇总辅助视图"
      mainClassName="mx-auto min-h-0 w-full max-w-[1780px] overflow-x-clip px-3 py-4 sm:px-5"
    >
      <AlphaResearchPage />
    </AppShell>
  );
}
