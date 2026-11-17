import { AppShell } from "@/components/app-shell";
import { NewsTerminal } from "@/components/news-terminal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function NewsPage() {
  return (
    <AppShell
      activeNav="news"
      subtitle="新闻交易"
      mainClassName="min-h-0 w-full p-0"
    >
      <NewsTerminal />
    </AppShell>
  );
}
