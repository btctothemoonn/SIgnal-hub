import assert from "node:assert/strict";
import {
  readBrowserStorage,
  parseBrowserJson,
  subscribeBrowserStorage,
  writeBrowserStorage,
} from "./browser-storage-store.ts";

const previousWindow = globalThis.window;

try {
  const values = new Map();
  const browserWindow = new EventTarget();
  Object.defineProperty(browserWindow, "localStorage", {
    configurable: true,
    value: {
      getItem(key) {
        return values.get(key) ?? null;
      },
      setItem(key, value) {
        values.set(key, value);
      },
    },
  });
  globalThis.window = browserWindow;

  assert.equal(readBrowserStorage("missing"), null);
  writeBrowserStorage("favorites", "[\"x:known\"]");
  assert.equal(readBrowserStorage("favorites"), "[\"x:known\"]");

  let notifications = 0;
  const unsubscribe = subscribeBrowserStorage("favorites", () => {
    notifications += 1;
  });

  window.dispatchEvent(
    new CustomEvent("signal-hub:storage-change", { detail: "unrelated" }),
  );
  const unrelatedStorageEvent = new Event("storage");
  Object.defineProperty(unrelatedStorageEvent, "key", { value: "unrelated" });
  window.dispatchEvent(unrelatedStorageEvent);
  assert.equal(notifications, 0);

  writeBrowserStorage("favorites", "[]");
  assert.equal(notifications, 1, "same-tab writes notify subscribers");

  const relatedStorageEvent = new Event("storage");
  Object.defineProperty(relatedStorageEvent, "key", { value: "favorites" });
  window.dispatchEvent(relatedStorageEvent);
  assert.equal(notifications, 2, "cross-tab writes notify subscribers");

  const clearedStorageEvent = new Event("storage");
  Object.defineProperty(clearedStorageEvent, "key", { value: null });
  window.dispatchEvent(clearedStorageEvent);
  assert.equal(notifications, 3, "cross-tab clears notify subscribers");

  unsubscribe();
  writeBrowserStorage("favorites", "[\"telegram:known\"]");
  assert.equal(notifications, 3);

  Object.defineProperty(browserWindow, "localStorage", {
    configurable: true,
    value: {
      getItem() {
        throw new Error("storage blocked");
      },
      setItem() {
        throw new Error("quota exceeded");
      },
    },
  });
  assert.equal(readBrowserStorage("favorites"), null);

  let deniedWriteNotifications = 0;
  const unsubscribeDeniedWrites = subscribeBrowserStorage("favorites", () => {
    deniedWriteNotifications += 1;
  });

  assert.doesNotThrow(() => writeBrowserStorage("favorites", "[\"x:denied\"]"));
  assert.equal(deniedWriteNotifications, 1);
  assert.equal(readBrowserStorage("favorites"), "[\"x:denied\"]");

  const recoveredValues = new Map();
  Object.defineProperty(browserWindow, "localStorage", {
    configurable: true,
    value: {
      getItem(key) {
        return recoveredValues.get(key) ?? null;
      },
      setItem(key, value) {
        recoveredValues.set(key, value);
      },
    },
  });
  writeBrowserStorage("favorites", "[\"x:recovered\"]");
  assert.equal(deniedWriteNotifications, 2);
  assert.equal(readBrowserStorage("favorites"), "[\"x:recovered\"]");
  recoveredValues.set("favorites", "[\"x:persistent\"]");
  assert.equal(readBrowserStorage("favorites"), "[\"x:persistent\"]");
  unsubscribeDeniedWrites();

  Object.defineProperty(browserWindow, "localStorage", {
    configurable: true,
    value: {
      getItem() {
        throw new Error("storage blocked again");
      },
      setItem() {
        throw new Error("quota exceeded again");
      },
    },
  });

  let remoteWriteNotifications = 0;
  const unsubscribeRemoteWrites = subscribeBrowserStorage("favorites", () => {
    remoteWriteNotifications += 1;
  });
  writeBrowserStorage("favorites", "[\"x:local-fallback\"]");
  assert.equal(remoteWriteNotifications, 1);
  assert.equal(readBrowserStorage("favorites"), "[\"x:local-fallback\"]");

  const remoteValues = new Map([["favorites", "[\"x:remote\"]"]]);
  Object.defineProperty(browserWindow, "localStorage", {
    configurable: true,
    value: {
      getItem(key) {
        return remoteValues.get(key) ?? null;
      },
      setItem(key, value) {
        remoteValues.set(key, value);
      },
    },
  });
  const remoteStorageEvent = new Event("storage");
  Object.defineProperty(remoteStorageEvent, "key", { value: "favorites" });
  window.dispatchEvent(remoteStorageEvent);
  assert.equal(remoteWriteNotifications, 2);
  assert.equal(readBrowserStorage("favorites"), "[\"x:remote\"]");
  unsubscribeRemoteWrites();

  Object.defineProperty(browserWindow, "localStorage", {
    configurable: true,
    value: {
      getItem() {
        throw new Error("storage blocked before clear");
      },
      setItem() {
        throw new Error("quota exceeded before clear");
      },
    },
  });
  writeBrowserStorage("favorites", "[\"x:stale-favorite\"]");
  writeBrowserStorage("alerts", "[\"x:stale-alert\"]");
  assert.equal(readBrowserStorage("favorites"), "[\"x:stale-favorite\"]");
  assert.equal(readBrowserStorage("alerts"), "[\"x:stale-alert\"]");

  let clearNotifications = 0;
  const unsubscribeClear = subscribeBrowserStorage("favorites", () => {
    clearNotifications += 1;
  });
  Object.defineProperty(browserWindow, "localStorage", {
    configurable: true,
    value: {
      getItem() {
        return null;
      },
      setItem() {},
    },
  });
  const remoteClearEvent = new Event("storage");
  Object.defineProperty(remoteClearEvent, "key", { value: null });
  window.dispatchEvent(remoteClearEvent);
  assert.equal(clearNotifications, 1);
  assert.equal(readBrowserStorage("favorites"), null);
  assert.equal(readBrowserStorage("alerts"), null);
  unsubscribeClear();

  assert.deepEqual(parseBrowserJson('{"value":1}'), { value: 1 });
  assert.equal(parseBrowserJson("not-json"), null);
  assert.equal(parseBrowserJson(null), null);
} finally {
  if (previousWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = previousWindow;
  }
}

assert.equal(readBrowserStorage("server"), null);

console.log("ok - browser storage store is hydration-safe and observable");
