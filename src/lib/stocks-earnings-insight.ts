import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getAlphaSummaryProviderCandidates,
  isMiniMaxBaseUrl,
} from "./alpha-summary.ts";
import { runWithAiProviderFallback } from "./ai-provider-fallback.ts";
import { getRuntimeDataPath } from "./runtime-storage.ts";
import type { StocksEarningsComparison } from "./stocks-earnings-comparison.ts";
import type { StocksFinancialSnapshot } from "./stocks-financial-data.ts";

type EnvLike = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type StocksEarningsInsight = {
  conclusion: string;
  driver: string;
  risk: string;
  source: "ai" | "rules";
  model: string | null;
  generatedAt: string;
};

function signedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function comparisonLabel(
  label: string,
  value: StocksEarningsComparison["revenue"],
) {
  if (value.surprisePct === null) return null;
  if (value.surprisePct > 0) return `${label}超预期 ${signedPercent(value.surprisePct)}`;
  if (value.surprisePct < 0) return `${label}不及预期 ${signedPercent(value.surprisePct)}`;
  return `${label}符合预期`;
}

export function buildDeterministicEarningsInsight(
  comparison: StocksEarningsComparison,
  { generatedAt = new Date().toISOString() } = {},
): StocksEarningsInsight {
  const revenueLabel = comparisonLabel("营收", comparison.revenue);
  const netIncomeLabel = comparisonLabel("净利润", comparison.netIncome);
  const completeConsensus = revenueLabel !== null && netIncomeLabel !== null;
  const conclusion = completeConsensus
    ? `${revenueLabel}，${netIncomeLabel.replace("净利润超预期", "净利润好于预期")}。`
    : "FMP 暂无完整一致预期，仅展示已公布数据。";

  let driver = "已公布营收和净利润是本期财报的主要核对项。";
  if (
    comparison.netIncome.actual !== null &&
    comparison.netIncome.estimate !== null &&
    comparison.netIncome.actual < 0 &&
    comparison.netIncome.estimate < 0 &&
    comparison.netIncome.surprise !== null &&
    comparison.netIncome.surprise > 0
  ) {
    driver = "净亏损较预期收窄，是净利润好于一致预期的直接原因。";
  } else if (revenueLabel) {
    driver = `${revenueLabel}，需结合后续季度验证持续性。`;
  }

  const risk =
    comparison.netIncome.actual !== null && comparison.netIncome.actual < 0
      ? "公司仍处于净亏损，盈利质量和亏损收窄节奏需继续跟踪。"
      : "单季结果不代表长期趋势，需继续跟踪下一季度增长和盈利表现。";

  return {
    conclusion,
    driver,
    risk,
    source: "rules",
    model: null,
    generatedAt,
  };
}

function validInsight(value: unknown): StocksEarningsInsight | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const conclusion =
    typeof record.conclusion === "string" ? record.conclusion.trim() : "";
  const driver = typeof record.driver === "string" ? record.driver.trim() : "";
  const risk = typeof record.risk === "string" ? record.risk.trim() : "";
  if (!conclusion || !driver || !risk) return null;
  return {
    conclusion,
    driver,
    risk,
    source: record.source === "ai" ? "ai" : "rules",
    model: typeof record.model === "string" ? record.model : null,
    generatedAt:
      typeof record.generatedAt === "string"
        ? record.generatedAt
        : new Date().toISOString(),
  };
}

function parseInsightContent(content: string) {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(normalized) as unknown;
  const insight = validInsight(parsed);
  if (!insight) throw new Error("Earnings insight returned invalid JSON fields");
  return insight;
}

function cacheFileName(comparison: StocksEarningsComparison) {
  return `${comparison.ticker}-${comparison.fiscalYear}-${comparison.quarter}.json`;
}

async function readCachedInsight(filePath: string) {
  try {
    return validInsight(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return null;
  }
}

async function writeCachedInsight(filePath: string, insight: StocksEarningsInsight) {
  await mkdir(join(filePath, ".."), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(insight), "utf8");
  await rename(temporaryPath, filePath);
}

function providerError(payload: Record<string, unknown>, status: number) {
  const error = payload.error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as Record<string, unknown>).message);
  }
  return `Earnings insight HTTP ${status}`;
}

export async function getOrCreateStocksEarningsInsight({
  comparison,
  fetchImpl = fetch,
  env = process.env,
  cacheDir,
  now = new Date(),
}: {
  comparison: StocksEarningsComparison;
  fetchImpl?: FetchLike;
  env?: EnvLike;
  cacheDir?: string;
  now?: Date;
}): Promise<StocksEarningsInsight> {
  const directory =
    cacheDir ?? getRuntimeDataPath(env, "stocks-earnings-insights");
  const cachePath = join(directory, cacheFileName(comparison));
  const cached = await readCachedInsight(cachePath);
  if (cached) return cached;

  const fallback = buildDeterministicEarningsInsight(comparison, {
    generatedAt: now.toISOString(),
  });
  const providers = getAlphaSummaryProviderCandidates(env);
  if (providers.length === 0) return fallback;

  const prompt = [
    "仅根据下列 FMP 财报数字生成中文投研摘要。",
    "返回 JSON，且只包含 conclusion、driver、risk 三个非空字符串。",
    "不得补充产品、客户、订单、指引、估值或新闻中不存在的原因。",
    JSON.stringify(comparison),
  ].join("\n");

  try {
    const result = await runWithAiProviderFallback({
      providers,
      shouldFallback: () => true,
      request: async (provider) => {
        const response = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: provider.model,
            messages: [
              {
                role: "system",
                content: "You summarize supplied earnings numbers without inventing facts.",
              },
              { role: "user", content: prompt },
            ],
            temperature: 0.1,
            ...(isMiniMaxBaseUrl(provider.baseUrl)
              ? {}
              : { response_format: { type: "json_object" } }),
          }),
          signal: AbortSignal.timeout(45_000),
        });
        const payload = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (!response.ok) throw new Error(providerError(payload, response.status));
        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        const message = (choices[0] as Record<string, unknown> | undefined)
          ?.message as Record<string, unknown> | undefined;
        const content = typeof message?.content === "string" ? message.content : "";
        if (!content) throw new Error("Earnings insight returned empty content");
        return parseInsightContent(content);
      },
    });
    const insight: StocksEarningsInsight = {
      ...result.value,
      source: "ai",
      model: result.provider.model,
      generatedAt: now.toISOString(),
    };
    await writeCachedInsight(cachePath, insight);
    return insight;
  } catch {
    return fallback;
  }
}

export async function enrichStocksFinancialSnapshotWithInsights(
  snapshot: StocksFinancialSnapshot,
  {
    fetchImpl = fetch,
    env = process.env,
    cacheDir,
    now = new Date(),
  }: {
    fetchImpl?: FetchLike;
    env?: EnvLike;
    cacheDir?: string;
    now?: Date;
  } = {},
): Promise<StocksFinancialSnapshot> {
  if (snapshot.provider !== "fmp") return snapshot;
  const financials = { ...snapshot.financials };
  for (const [ticker, statement] of Object.entries(financials)) {
    if (!statement.latestEarnings) continue;
    financials[ticker] = {
      ...statement,
      earningsInsight: await getOrCreateStocksEarningsInsight({
        comparison: statement.latestEarnings,
        fetchImpl,
        env,
        cacheDir,
        now,
      }),
    };
  }
  return { ...snapshot, financials };
}
