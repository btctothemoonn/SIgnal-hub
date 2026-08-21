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
const appLayout = await readFile("src/app/layout.tsx", "utf8");
const settingsPage = await readFile("src/app/settings/page.tsx", "utf8");
const themeToggle = await readFile("src/components/theme-toggle.tsx", "utf8");
const stocksPerformanceChart = await readFile(
  "src/components/stocks-performance-chart.tsx",
  "utf8",
);
const stocksHynixPremiumCurve = await readFile(
  "src/components/stocks-hynix-premium-curve.tsx",
  "utf8",
);

await test("global theme keeps a light revenue-dashboard workspace palette", () => {
  assert.match(globals, /:root\s*\{[\s\S]*--background:\s*#f3f8f6;/);
  assert.match(globals, /:root\s*\{[\s\S]*--foreground:\s*#10151b;/);
  assert.match(globals, /:root\s*\{[\s\S]*--panel:\s*#ffffff;/);
  assert.match(globals, /:root\s*\{[\s\S]*--accent:\s*#6c5ce7;/);
  assert.match(globals, /:root\s*\{[\s\S]*--success:\s*#14b8a6;/);
  assert.match(globals, /:root\s*\{[\s\S]*--workspace-rail:\s*#f8fbfa;/);
  assert.match(globals, /:root\s*\{[\s\S]*--workspace-toolbar:\s*#ffffff;/);
  assert.match(globals, /html\.dark\s*\{[\s\S]*--background:\s*#111817;/);
  assert.match(globals, /html\.dark\s*\{[\s\S]*--foreground:\s*#edf1f4;/);
  assert.match(globals, /html\.dark\s*\{[\s\S]*--success:\s*#2dd4bf;/);
  assert.match(globals, /html\.dark\s*\{[\s\S]*--info:\s*#38bdf8;/);
  assert.match(globals, /--app-font-serif:/);
  assert.match(globals, /--font-serif:\s*var\(--app-font-serif\);/);
  assert.match(globals, /linear-gradient\(180deg,\s*#f8fcfa 0%,\s*#f3f8f6 44%,\s*#edf4f1 100%\)/);
  assert.doesNotMatch(globals, /radial-gradient/);
  assert.doesNotMatch(globals, /#00e887|rgba\(0,\s*232,\s*135/);
  assert.doesNotMatch(globals, /28px 28px/);
});

await test("command workspace tokens define Cromojo-like product surfaces", () => {
  assert.match(globals, /--workspace-canvas:/);
  assert.match(globals, /--workspace-rail:/);
  assert.match(globals, /--workspace-surface:/);
  assert.match(globals, /--workspace-surface-raised:/);
  assert.match(globals, /--workspace-toolbar:/);
  assert.match(globals, /--workspace-line-strong:/);
  assert.match(globals, /--workspace-radius:\s*8px;/);
  assert.match(globals, /--workspace-gutter:/);
  assert.match(
    globals,
    /html\.dark\s*\{[\s\S]*--workspace-canvas:\s*#111817;/,
  );
  assert.match(globals, /--color-workspace-canvas:/);
  assert.doesNotMatch(globals, /letter-spacing:\s*-/);
});

await test("app shell exposes product sidebar and toolbar surfaces", () => {
  assert.match(appShell, /bg-workspace-rail/);
  assert.match(appShell, /bg-workspace-toolbar/);
  assert.match(appShell, /w-\[13\.5rem\]/);
  assert.match(appShell, /justify-start/);
  assert.match(appShell, /border-success\/45 bg-success-soft text-foreground shadow-sm/);
  assert.match(appShell, /hover:border-success\/30 hover:bg-success-soft\/70 hover:text-foreground/);
  assert.match(appShell, /Signal Hub/);
  assert.doesNotMatch(appShell, /font-black|rgba\(0,232,135/);
  assert.match(
    appShell,
    /overflow-x-auto[^\n]*\[scrollbar-width:none\][^\n]*\[&::\-webkit-scrollbar\]:hidden/,
  );
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

await test("theme defaults to dark workspace mode until user opts out", () => {
  assert.match(appLayout, /t===null/);
  assert.match(appLayout, /signal-hub:theme:cromojo-dark-dashboard:v1/);
  assert.doesNotMatch(appLayout, /signal-hub:theme:cromojo-dashboard:v1/);
  assert.match(themeToggle, /THEME_STORAGE_KEY = "signal-hub:theme:cromojo-dark-dashboard:v1"/);
  assert.match(themeToggle, /typeof window === "undefined"\) return "dark";/);
  assert.match(themeToggle, /stored === "system"/);
  assert.match(themeToggle, /getServerThemeSnapshot\(\): Theme \{\s*return "dark";/);
});

await test("page headings avoid mockup-like terminal typography", async () => {
  const alphaResearch = await readFile(
    "src/components/alpha-research-page.tsx",
    "utf8",
  );
  const holdingPanel = await readFile("src/components/holding-panel.tsx", "utf8");
  assert.doesNotMatch(alphaResearch, /font-mono text-2xl font-black/);
  assert.doesNotMatch(holdingPanel, /font-mono text-lg font-black/);
  assert.doesNotMatch(settingsPage, /font-mono text-2xl font-black/);
});

await test("settings page uses the full-site redesigned surface width", () => {
  assert.match(settingsPage, /<AppShell/);
  assert.match(settingsPage, /activeNav="settings"/);
  assert.match(settingsPage, /max-w-\[1180px\]/);
  assert.doesNotMatch(settingsPage, /font-serif/);
  assert.match(
    settingsPage,
    /overflow-x-auto[^\n]*\[scrollbar-width:none\][^\n]*\[&::\-webkit-scrollbar\]:hidden/,
  );
  assert.match(
    settingsPage,
    /rounded-lg border border-line\/70 bg-panel-strong/,
  );
  assert.doesNotMatch(settingsPage, /rounded-2xl|rounded-3xl/);
});

await test("stocks performance chart uses the light product surface", () => {
  assert.match(stocksPerformanceChart, /data-stocks-performance-chart/);
  assert.match(stocksPerformanceChart, /bg-panel-strong/);
  assert.match(stocksPerformanceChart, /fill="var\(--workspace-surface\)"/);
  assert.match(stocksPerformanceChart, /stroke="var\(--line\)"/);
  assert.doesNotMatch(stocksPerformanceChart, /bg-\[#10141f\]|fill="#10141f"|text-slate-300|border-white\/10/);
});

await test("hynix premium chart uses the dark product chart theme", () => {
  assert.match(stocksHynixPremiumCurve, /data-testid="stocks-hynix-premium-curve"/);
  assert.match(stocksHynixPremiumCurve, /CHART_SURFACE = "#17211f"/);
  assert.match(stocksHynixPremiumCurve, /CHART_TEXT = "#9eaaa7"/);
  assert.match(stocksHynixPremiumCurve, /CHART_ACCENT = "#2dd4bf"/);
  assert.match(stocksHynixPremiumCurve, /PREMIUM_DOWN_COLOR = "#f97066"/);
  assert.match(stocksHynixPremiumCurve, /labelBackgroundColor: CHART_ACCENT/);
  assert.match(stocksHynixPremiumCurve, /rounded-lg border border-line\/60 bg-panel-strong/);
  assert.doesNotMatch(stocksHynixPremiumCurve, /CHART_SURFACE = "#ffffff"|CHART_TEXT = "#647370"|rgba\(17, 24, 28, 0\.08\)|rounded-\[6px\] border border-line\/60 bg-background\/35/);
});
