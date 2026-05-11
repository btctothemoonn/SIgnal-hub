const DEFAULT_HEADERS = {
  Accept: "application/json, text/event-stream",
  "Cache-Control": "no-cache",
  "User-Agent": "SignalHub-985monitor-worker/1.0",
};

type Monitor985AuthEnv = Record<string, string | undefined>;

function envText(env: Monitor985AuthEnv, key: string): string {
  return env[key]?.trim() || "";
}

export function describeMonitor985AuthMode(env: Monitor985AuthEnv = process.env) {
  if (envText(env, "MONITOR985_USER_ID") && envText(env, "MONITOR985_USER_TOKEN")) {
    return "user-token";
  }

  if (envText(env, "MONITOR985_AUTH_COOKIE")) {
    return "cookie";
  }

  return "public";
}

export function buildMonitor985RequestHeaders(
  env: Monitor985AuthEnv = process.env,
): Record<string, string> {
  const headers: Record<string, string> = { ...DEFAULT_HEADERS };
  const userId = envText(env, "MONITOR985_USER_ID");
  const userToken = envText(env, "MONITOR985_USER_TOKEN");
  const walletAddress = envText(env, "MONITOR985_WALLET_ADDRESS") || userId;
  const cookie = envText(env, "MONITOR985_AUTH_COOKIE");

  if (userId && userToken) {
    headers["X-User-Id"] = userId;
    headers["X-User-Token"] = userToken;
    headers["X-Wallet-Address"] = walletAddress;
  }

  if (cookie) {
    headers.Cookie = cookie;
  }

  return headers;
}

export function buildMonitor985RequestUrl(
  path: string,
  baseUrl: string,
  env: Monitor985AuthEnv = process.env,
): string {
  const url = new URL(path, baseUrl);
  const userId = envText(env, "MONITOR985_USER_ID");
  const userToken = envText(env, "MONITOR985_USER_TOKEN");

  if (userId && userToken) {
    url.searchParams.set("userId", userId);
    url.searchParams.set("userToken", userToken);
  }

  return url.toString();
}
