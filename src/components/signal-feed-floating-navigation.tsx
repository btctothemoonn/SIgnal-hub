import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bookmark,
  type LucideIcon,
} from "lucide-react";

type SignalFeedFloatingNavigationProps = {
  showLatest: boolean;
  newCount: number;
  onLatest: () => void;
  onSaved: () => void;
  onOldest: () => void;
};

type ReadingNavigationButtonProps = {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  hidden?: boolean;
  badge?: number;
};

function ReadingNavigationButton({
  label,
  icon: Icon,
  onClick,
  hidden = false,
  badge = 0,
}: ReadingNavigationButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`relative flex h-9 w-9 items-center justify-center rounded-[6px] border border-workspace-line-strong bg-workspace-surface-raised text-foreground transition-colors hover:border-accent/70 hover:bg-workspace-surface ${
        hidden ? "pointer-events-none invisible" : ""
      }`}
    >
      <Icon aria-hidden className="h-4 w-4" />
      {badge > 0 ? (
        <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 text-background">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

export function SignalFeedFloatingNavigation({
  showLatest,
  newCount,
  onLatest,
  onSaved,
  onOldest,
}: SignalFeedFloatingNavigationProps) {
  return (
    <nav
      data-signal-feed-floating-navigation
      aria-label="消息阅读导航"
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-2 z-40 flex flex-col gap-1 lg:absolute lg:bottom-auto lg:right-1 lg:top-1/2 lg:-translate-y-1/2"
    >
      <ReadingNavigationButton
        label="回到最新消息"
        icon={ArrowUpToLine}
        onClick={onLatest}
        hidden={!showLatest}
        badge={newCount > 0 ? newCount : 0}
      />
      <ReadingNavigationButton
        label="返回上次阅读"
        icon={Bookmark}
        onClick={onSaved}
      />
      <ReadingNavigationButton
        label="跳到最早消息"
        icon={ArrowDownToLine}
        onClick={onOldest}
      />
    </nav>
  );
}
