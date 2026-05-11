export function makeTelegramClientOptions() {
  return {
    connectionRetries: 3,
    reconnectRetries: 0,
    retryDelay: 2000,
    autoReconnect: false,
    maxConcurrentDownloads: 1,
  };
}
