"use client";

import { useEffect, useMemo, useState } from "react";
import { useBrowserJsonCache } from "@/components/use-browser-json-cache";
import type {
  BinanceHynixPremiumPoint,
  BinanceHynixPremiumSnapshot,
} from "@/lib/binance-hynix-premium";

const STOCKS_HYNIX_PREMIUM_CACHE_KEY =
  "signal-hub:stocks:hynix-premium:5m:v1";

function formatSignedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

function formatPrice(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function premiumTone(value: number | null | undefined) {
  if (typeof value !== "number") return "text-muted";
  if (value > 0) return "text-success";
  if (value < 0) return "text-danger";
  return "text-muted";
}

function linePoints({
  points,
  width,
  height,
  left,
  top,
}: {
  points: BinanceHynixPremiumPoint[];
  width: number;
  height: number;
  left: number;
  top: number;
}) {
  if (points.length === 0) return "";
  const values = points.map((point) => point.premiumPct);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const pad = Math.max(0.25, (max - min) * 0.18);
  const yMin = min - pad;
  const yMax = max + pad;
  const span = yMax - yMin || 1;
  const lastIndex = Math.max(1, points.length - 1);
  return points
    .map((point, index) => {
      const x = left + (index / lastIndex) * width;
      const y = top + height - ((point.premiumPct - yMin) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function StocksHynixPremiumCurve() {
  const [liveSnapshot, setLiveSnapshot] =
    useState<BinanceHynixPremiumSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cachedSnapshot, writeCachedSnapshot] =
    useBrowserJsonCache<BinanceHynixPremiumSnapshot>(
      STOCKS_HYNIX_PREMIUM_CACHE_KEY,
    );
  const snapshot = liveSnapshot ?? cachedSnapshot;
  const points = snapshot?.points ?? [];
  const latest = snapshot?.latest ?? points.at(-1) ?? null;
  const shownPoints = points.slice(-144);
  const polylinePoints = useMemo(
    () =>
      linePoints({
        points: shownPoints,
        width: 624,
        height: 120,
        left: 42,
        top: 24,
      }),
    [shownPoints],
  );
  const firstPoint = shownPoints[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    async function loadPremiumData() {
      try {
        setError(null);
        const response = await fetch("/api/stocks-hynix-premium?limit=144", {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`hynix premium HTTP ${response.status}`);
        }
        const snapshot = (await response.json()) as BinanceHynixPremiumSnapshot;
        if (!cancelled) {
          setLiveSnapshot(snapshot);
          if (snapshot.points.length > 0) writeCachedSnapshot(snapshot);
          setError(snapshot.errors[0] ?? null);
        }
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : String(error));
        }
      }
    }

    void loadPremiumData();
    const timer = window.setInterval(loadPremiumData, 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [writeCachedSnapshot]);

  return (
    <section
      data-testid="stocks-hynix-premium-curve"
      className="min-w-0 border-y border-line/60 bg-panel-strong/80 px-3 py-3 sm:px-4"
    >
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            币安海力士溢价曲线
          </h2>
          <p className="mt-0.5 text-[11px] text-muted">
            SKHYUSDT * 10 / SKHYNIXUSDT · 5m K 线 · Binance Alpha
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:min-w-[30rem]">
          <div className="rounded-md border border-line/60 bg-background/35 px-3 py-2">
            <p className="text-[10px] font-semibold text-muted">当前溢价</p>
            <p
              className={`mt-1 font-mono text-lg font-semibold ${premiumTone(
                latest?.premiumPct,
              )}`}
            >
              {latest ? formatSignedPercent(latest.premiumPct) : "--"}
            </p>
          </div>
          <div className="rounded-md border border-line/60 bg-background/35 px-3 py-2">
            <p className="text-[10px] font-semibold text-muted">SKHYUSDT</p>
            <p className="mt-1 truncate font-mono text-sm font-semibold text-foreground">
              {latest ? formatPrice(latest.basePrice) : "--"}
            </p>
          </div>
          <div className="rounded-md border border-line/60 bg-background/35 px-3 py-2">
            <p className="text-[10px] font-semibold text-muted">SKHYNIXUSDT</p>
            <p className="mt-1 truncate font-mono text-sm font-semibold text-foreground">
              {latest ? formatPrice(latest.benchmarkPrice) : "--"}
            </p>
          </div>
        </div>
      </div>

      <div className="min-w-0 overflow-hidden rounded-lg border border-line/60 bg-background/35">
        {shownPoints.length > 1 ? (
          <svg
            viewBox="0 0 720 178"
            role="img"
            aria-label="SKHYUSDT times 10 against SKHYNIXUSDT 5 minute premium curve"
            className="block h-48 w-full"
          >
            <line x1="42" y1="84" x2="666" y2="84" stroke="currentColor" className="text-line" />
            <line x1="42" y1="24" x2="42" y2="144" stroke="currentColor" className="text-line" />
            <line x1="666" y1="24" x2="666" y2="144" stroke="currentColor" className="text-line" />
            <polyline
              points={polylinePoints}
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.8"
              className="text-accent"
            />
            {latest ? (
              <>
                <circle
                  cx="666"
                  cy={polylinePoints.split(" ").at(-1)?.split(",")[1] ?? "84"}
                  r="4"
                  fill="currentColor"
                  className="text-accent"
                />
                <text x="676" y="88" className="fill-foreground text-[12px] font-semibold">
                  {formatSignedPercent(latest.premiumPct)}
                </text>
              </>
            ) : null}
            <text x="42" y="166" className="fill-muted text-[11px]">
              {firstPoint ? formatTime(firstPoint.capturedAt) : ""}
            </text>
            <text x="666" y="166" textAnchor="end" className="fill-muted text-[11px]">
              {latest ? formatTime(latest.capturedAt) : ""}
            </text>
          </svg>
        ) : (
          <div className="flex h-48 items-center justify-center px-4 text-sm text-muted">
            {error ?? "等待 Binance 5m K 线数据。"}
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span>{snapshot ? `${shownPoints.length} 根 5m K 线` : "加载中"}</span>
        {latest ? <span>更新 {formatTime(latest.capturedAt)}</span> : null}
        {error ? <span className="text-warning">{error}</span> : null}
      </div>
    </section>
  );
}
