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

await test("command workspace tokens define dark and light operational surfaces", () => {
  assert.match(globals, /--workspace-canvas:/);
  assert.match(globals, /--workspace-rail:/);
  assert.match(globals, /--workspace-surface:/);
  assert.match(globals, /--workspace-surface-raised:/);
  assert.match(globals, /--workspace-toolbar:/);
  assert.match(globals, /--workspace-line-strong:/);
  assert.match(globals, /--workspace-radius:\s*6px;/);
  assert.match(globals, /--workspace-gutter:/);
  assert.match(
    globals,
    /html\.dark\s*\{[\s\S]*--workspace-canvas:/,
  );
  assert.match(globals, /--color-workspace-canvas:/);
  assert.doesNotMatch(globals, /letter-spacing:\s*-/);
});

await test("app shell exposes workspace navigation and toolbar surfaces", () => {
  assert.match(appShell, /bg-workspace-rail/);
  assert.match(appShell, /bg-workspace-toolbar/);
  assert.match(appShell, /border-accent\/40 bg-accent-soft text-accent/);
  assert.doesNotMatch(appShell, /font-serif/);
  assert.doesNotMatch(appShell, /bg-info text-sm font-bold text-white/);
});

await test("app shell gives sidebar navigation immediate optimistic feedback", () => {
  assert.match(appShell, /"use client";/);
  assert.match(appShell, /const \[pendingNav, setPendingNav\] = useState/);
  assert.match(
    appShell,
    /pendingNav\?\.origin === activeNav \? pendingNav\.target : activeNav/,
  );
  assert.match(appShell, /setPendingNav\(\{ origin: activeNav, target \}\)/);
  assert.match(appShell, /window\.clearTimeout\(pendingNavTimerRef\.current\)/);
  assert.match(appShell, /window\.setTimeout\(\(\) => \{/);
  assert.match(appShell, /setPendingNav\(null\)/);
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
  assert.match(
    settingsPage,
    /rounded-\[6px\] border border-line\/70 bg-panel-strong/,
  );
  assert.doesNotMatch(settingsPage, /rounded-2xl|rounded-3xl/);
});
