import { AppShell } from "@/components/app-shell";
import { SignalsResponsiveLayout } from "@/components/signals-responsive-layout";
import { prepareTelegramSnapshotForClient } from "@/lib/telegram-client-snapshot";
import { getTelegramPipelineSnapshot } from "@/lib/telegram-pipeline-store";
import { getXPipelineSnapshot } from "@/lib/x-pipeline-store";
import { isXRestSnapshotMode } from "@/lib/x-snapshot-mode";

export const dynamic = "force-dynamic";

export default async function Home() {
  const pollXSnapshot = isXRestSnapshotMode();
  const [telegramSnapshot, xSnapshot] = await Promise.all([
    Promise.resolve(getTelegramPipelineSnapshot()),
    Promise.resolve(getXPipelineSnapshot(0)),
  ]);
  return (
    <AppShell
      activeNav="signals"
      mainClassName="mx-auto w-full max-w-[1780px] min-h-0 px-3 py-3 sm:px-5 lg:py-4"
    >
      <SignalsResponsiveLayout
        initialTelegramSnapshot={prepareTelegramSnapshotForClient(
          telegramSnapshot,
        )}
        initialXSnapshot={xSnapshot}
        pollXSnapshot={pollXSnapshot}
      />
    </AppShell>
  );
}
