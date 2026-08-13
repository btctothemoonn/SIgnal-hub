import { AppShell, type AppShellNavKey } from "@/components/app-shell";

export function WorkspaceRouteLoading({
  activeNav,
}: {
  activeNav: AppShellNavKey;
}) {
  return (
    <AppShell
      activeNav={activeNav}
      mainClassName="mx-auto min-h-0 w-full max-w-[1780px] px-3 py-4 sm:px-5"
    >
      <div
        data-workspace-route-loading
        aria-busy="true"
        aria-live="polite"
        className="grid min-h-[60vh] gap-3"
      >
        <span className="sr-only">页面加载中</span>
        <div className="h-16 animate-pulse rounded-[6px] border border-workspace-line-strong bg-workspace-surface-raised" />
        <div className="grid min-h-[30rem] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.34fr)]">
          <div className="animate-pulse rounded-[6px] border border-workspace-line-strong bg-workspace-surface" />
          <div className="hidden animate-pulse rounded-[6px] border border-workspace-line-strong bg-workspace-surface-raised lg:block" />
        </div>
      </div>
    </AppShell>
  );
}
