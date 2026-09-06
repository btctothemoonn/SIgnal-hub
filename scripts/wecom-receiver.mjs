import { createWecomReceiver, wecomReceiverPort } from "../src/lib/wecom-receiver.ts";
import { wecomSyncConfigured } from "../src/lib/wecom-signature.ts";

if (!wecomSyncConfigured()) {
  console.log("WeCom receiver disabled: sync_unconfigured");
} else {
  const server = createWecomReceiver();
  server.on("error", () => { console.error("WeCom receiver: listen_failed"); process.exitCode = 1; });
  server.listen(wecomReceiverPort(), "127.0.0.1", () => console.log("WeCom receiver listening on loopback"));
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 5000).unref();
  });
}
