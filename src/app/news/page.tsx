import { AppShell } from "@/components/app-shell";
import { NewsTerminal } from "@/components/news-terminal";
import { parseNewsMarketSymbol } from "@/lib/news-terminal-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function NewsPage({ searchParams }: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  const symbol = parseNewsMarketSymbol((await searchParams).symbol);
  return (
    <AppShell
      activeNav="news"
      subtitle="新闻交易"
      mainClassName="min-h-0 w-full p-0"
    >
      <NewsTerminal key={symbol ?? "default"} initialSymbol={symbol} />
    </AppShell>
  );
}
