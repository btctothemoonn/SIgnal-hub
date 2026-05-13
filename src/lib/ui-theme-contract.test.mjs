import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

const globals = await readFile("src/app/globals.css", "utf8");
const appShell = await readFile("src/components/app-shell.tsx", "utf8");
const settingsPage = await readFile("src/app/settings/page.tsx", "utf8");

await test("global theme uses the mobile command dark palette", () => {
  assert.match(globals, /--background:\s*#101312;/);
  assert.match(globals, /--foreground:\s*#f4f1ea;/);
  assert.match(globals, /--accent:\s*#d7b56d;/);
  assert.match(globals, /html\.dark\s*\{[\s\S]*--background:\s*#0c0f0e;/);
  assert.match(globals, /--app-font-serif:/);
  assert.match(globals, /--font-serif:\s*var\(--app-font-serif\);/);
  assert.doesNotMatch(globals, /28px 28px/);
});

await test("app shell exposes the redesigned accent navigation and serif identity", () => {
  assert.match(appShell, /border-accent\/35 bg-accent-soft text-accent/);
  assert.match(appShell, /font-serif/);
  assert.match(appShell, /bg-panel-strong\/90/);
  assert.doesNotMatch(appShell, /bg-info text-sm font-bold text-white/);
});

await test("app shell gives sidebar navigation immediate optimistic feedback", () => {
  assert.match(appShell, /"use client";/);
  assert.match(appShell, /useState<AppShellNavKey>\(activeNav\)/);
  assert.match(appShell, /onPointerDown=\{\(\) => \{/);
  assert.match(appShell, /onActivate\(item\.key\);/);
  assert.match(appShell, /onWarm\?\.\(item\);/);
  assert.match(appShell, /active:scale-\[0\.98\]/);
  assert.match(appShell, /duration-75/);
});

await test("app shell keeps undecided market navigation hidden", () => {
  assert.doesNotMatch(appShell, /label:\s*"市场"/);
  assert.doesNotMatch(appShell, /key:\s*"markets"/);
  assert.doesNotMatch(appShell, /\/#markets/);
});

await test("settings page uses the full-site redesigned surface width", () => {
  assert.match(settingsPage, /max-w-\[1180px\]/);
  assert.match(settingsPage, /font-serif/);
  assert.match(settingsPage, /rounded-lg border border-line\/70 bg-panel-strong/);
});
