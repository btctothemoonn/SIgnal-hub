type SignalFeedFloatingNavigationProps = {
  showLatest: boolean;
  newCount: number;
  onLatest: () => void;
  onSaved: () => void;
  onOldest: () => void;
};

type ReadingNavigationButtonProps = {
  label: string;
  icon: string;
  onClick: () => void;
  hidden?: boolean;
  badge?: number;
};

function ReadingNavigationButton({
  label,
  icon,
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
      className={`relative flex h-9 w-9 items-center justify-center gap-1.5 rounded-md border border-line/80 bg-panel-strong/95 px-0 text-xs font-medium text-foreground shadow-lg shadow-black/25 backdrop-blur transition-colors hover:border-accent/70 hover:bg-panel lg:w-auto lg:min-w-[6.5rem] lg:justify-start lg:px-2.5 ${
        hidden ? "pointer-events-none invisible" : ""
      }`}
    >
      <span aria-hidden="true" className="text-base leading-none">
        {icon}
      </span>
      <span className="hidden lg:inline">{label}</span>
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
      className="fixed right-3 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-1.5 lg:absolute lg:right-2 lg:top-[62%]"
    >
      <ReadingNavigationButton
        label="回到最新消息"
        icon="↑"
        onClick={onLatest}
        hidden={!showLatest}
        badge={newCount > 0 ? newCount : 0}
      />
      <ReadingNavigationButton
        label="返回上次阅读"
        icon="↩"
        onClick={onSaved}
      />
      <ReadingNavigationButton
        label="跳到最早消息"
        icon="↓"
        onClick={onOldest}
      />
    </nav>
  );
}
