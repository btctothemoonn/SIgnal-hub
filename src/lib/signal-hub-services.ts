export type SignalHubSystemdService = {
  name: string;
  label: string;
  category: "web" | "collector" | "cache" | "ai" | "holding";
  required: boolean;
};

export const SIGNAL_HUB_SYSTEMD_SERVICES: SignalHubSystemdService[] = [
  { name: "signal-hub-x-owned-reader", label: "X 自有账号补采", category: "collector", required: false },
  { name: "signal-hub-web-push", label: "重要通知", category: "collector", required: false },
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
    name: "signal-hub-daily-brief",
    label: "每日投资简报",
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
  {
    name: "signal-hub-market-volatility-rest",
    label: "暴涨暴跌 REST",
    category: "collector",
    required: true,
  },
  {
    name: "signal-hub-market-volatility-ws",
    label: "暴涨暴跌实时流",
    category: "collector",
    required: true,
  },
  {
    name: "signal-hub-market-squeeze",
    label: "轧空监控",
    category: "collector",
    required: true,
  },
  {
    name: "signal-hub-market-opportunity",
    label: "做单决策",
    category: "ai",
    required: true,
  },
];

export function isSignalHubServiceEnabled(name: string, env: Record<string, string | undefined> = process.env) {
  if (name === "signal-hub-x-owned-reader") {
    return ["1", "true", "yes", "on"].includes(env.X_OWNED_READER_ENABLED?.trim().toLowerCase() || "");
  }
  return name !== "signal-hub-web-push" || env.WEB_PUSH_ENABLED === "true";
}
export function getEnabledSignalHubSystemdServices(env: Record<string, string | undefined> = process.env) {
  return SIGNAL_HUB_SYSTEMD_SERVICES.filter(service => isSignalHubServiceEnabled(service.name, env));
}

export function getSignalHubSystemdServiceNames() {
  return SIGNAL_HUB_SYSTEMD_SERVICES.map((service) => service.name);
}

export function getSignalHubSystemdServiceLabel(name: string) {
  return (
    SIGNAL_HUB_SYSTEMD_SERVICES.find((service) => service.name === name)?.label ?? name
  );
}
