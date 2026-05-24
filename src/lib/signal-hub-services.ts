export type SignalHubSystemdService = {
  name: string;
  label: string;
  category: "web" | "collector" | "cache" | "ai" | "holding";
  required: boolean;
};

export const SIGNAL_HUB_SYSTEMD_SERVICES: SignalHubSystemdService[] = [
  {
    name: "signal-hub-web",
    label: "Web 应用",
    category: "web",
    required: true,
  },
  {
    name: "signal-hub-telegram",
    label: "Telegram 采集",
    category: "collector",
    required: true,
  },
  {
    name: "signal-hub-x-hybrid",
    label: "X 混合采集",
    category: "collector",
    required: true,
  },
  {
    name: "signal-hub-monitor985",
    label: "985 采集",
    category: "collector",
    required: true,
  },
  {
    name: "signal-hub-stocks-cache",
    label: "Stocks 缓存预热",
    category: "cache",
    required: true,
  },
  {
    name: "signal-hub-alpha-summary",
    label: "AI 总结预热",
    category: "ai",
    required: true,
  },
  {
    name: "signal-hub-tiger-holdings",
    label: "Tiger 持仓缓存",
    category: "holding",
    required: true,
  },
  {
    name: "signal-hub-douyin",
    label: "抖音采集",
    category: "collector",
    required: true,
  },
];

export function getSignalHubSystemdServiceNames() {
  return SIGNAL_HUB_SYSTEMD_SERVICES.map((service) => service.name);
}

export function getSignalHubSystemdServiceLabel(name: string) {
  return (
    SIGNAL_HUB_SYSTEMD_SERVICES.find((service) => service.name === name)?.label ?? name
  );
}
