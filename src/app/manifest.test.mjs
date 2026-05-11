import assert from "node:assert/strict";

const { default: manifest } = await import("./manifest.ts");

const appManifest = manifest();

assert.equal(appManifest.name, "Signal Hub");
assert.equal(appManifest.short_name, "Signal Hub");
assert.equal(
  appManifest.description,
  "Private real-time signal dashboard for Telegram, X, market alerts, and holdings.",
);
assert.equal(appManifest.start_url, "/");
assert.equal(appManifest.scope, "/");
assert.equal(appManifest.display, "standalone");
assert.equal(appManifest.background_color, "#f7f0e6");
assert.equal(appManifest.theme_color, "#261f1b");
assert.deepEqual(appManifest.icons, [
  {
    src: "/icon-192x192.png",
    sizes: "192x192",
    type: "image/png",
    purpose: "maskable",
  },
  {
    src: "/icon-512x512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
]);

console.log("ok - pwa manifest contract");
