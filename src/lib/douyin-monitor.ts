import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  runWithAiProviderFallback,
  type AiProviderConfig,
} from "./ai-provider-fallback.ts";
import { loadRuntimeConfig, type RuntimeWatchItem } from "./runtime-config.ts";
import { getRuntimeDataPath } from "./runtime-storage.ts";

type EnvLike = Record<string, string | undefined>;
type DbRow = Record<string, unknown>;

export type DouyinVideoSummary = {
  status: "generated" | "limited" | "error";
  coreView: string;
  assets: string[];
  recommendationReasons: string[];
  catalysts: string[];
  risks: string[];
  followUps: string[];
  error?: string | null;
};

export type DouyinVideoSource = "public_page" | "rsshub" | "tikhub";

export type DouyinVideoRecord = {
  id: string;
  creatorRef: string;
  creatorName: string;
  title: string;
  description: string;
  publishedAt: string | null;
  videoUrl: string;
  coverUrl: string | null;
  source: DouyinVideoSource;
  fetchedAt: string;
  firstSeenAt: string;
  updatedAt: string;
  summary: DouyinVideoSummary | null;
  summaryStatus: DouyinVideoSummary["status"] | "pending";
  error: string | null;
};

export type DouyinRefreshResult = {
  creatorRef: string;
  creatorName: string | null;
  status: "ok" | "empty" | "error";
  fetchedAt: string;
  inserted: number;
  videoCount: number;
  error: string | null;
};

export type DouyinSnapshot = {
  success: boolean;
  configured: boolean;
  status: "empty" | "ok" | "partial" | "error";
  generatedAt: string;
  lastUpdatedAt: string | null;
  creators: RuntimeWatchItem[];
  videos: DouyinVideoRecord[];
  errors: DouyinRefreshResult[];
};

type RawDouyinVideo = Omit<DouyinVideoRecord, "firstSeenAt" | "updatedAt" | "summary" | "summaryStatus" | "error">;

const DEFAULT_DOUYIN_DB = "douyin-monitor.sqlite";
const DEFAULT_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_FETCH_LIMIT = 12;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MINIMAX_BASE_URL = "https://api.minimaxi.com/v1";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIKHUB_BASE_URL = "https://api.tikhub.io";
const DEFAULT_TIKHUB_USER_POSTS_PATH = "/api/v1/douyin/app/v3/fetch_user_post_videos";
const DEFAULT_MINIMAX_MODEL = "MiniMax-M2.7";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveInt(raw: string | undefined, fallback: number) {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeIsoDate(raw: string | undefined | null) {
  const value = raw?.trim();
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function cleanText(value: string, maxChars = 900) {
  const normalized = value
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars).trim()}...`
    : normalized;
}

function uniqueStrings(values: string[], max = 12) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = cleanText(value, 80);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseJsonArray(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw;
}

function parseStringArray(raw: unknown): string[] {
  return parseJsonArray(raw)
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 10);
}

function objectArrayAtPath(value: unknown, path: string[]): Record<string, unknown>[] {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return [];
    current = (current as Record<string, unknown>)[part];
  }
  return Array.isArray(current)
    ? current.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function decodeHtmlEntity(text: string) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function maybeDecodeURIComponent(text: string) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function objectAtPath(record: Record<string, unknown>, path: string[]) {
  let value: unknown = record;
  for (const part of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const found = firstString(...value);
      if (found) return found;
    }
  }
  return "";
}

function dateFromUnixSeconds(value: unknown): string | null {
  const seconds = numberValue(value);
  if (!seconds) return null;
  const ms = seconds > 10_000_000_000 ? seconds : seconds * 1000;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function stableVideoId(videoUrl: string, text: string) {
  return createHash("sha1")
    .update(`${videoUrl}\n${text}`)
    .digest("hex")
    .slice(0, 16);
}

function normalizeDouyinVideoUrl(raw: string, id: string) {
  if (raw.startsWith("http")) return raw;
  if (id) return `https://www.douyin.com/video/${id}`;
  return raw;
}

function extractCoverUrl(record: Record<string, unknown>) {
  return firstString(
    objectAtPath(record, ["video", "cover", "url_list"]),
    objectAtPath(record, ["video", "origin_cover", "url_list"]),
    objectAtPath(record, ["cover", "url_list"]),
    objectAtPath(record, ["cover"]),
    objectAtPath(record, ["image", "url_list"]),
  );
}

function uniqueTextParts(values: string[], max = 12) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = cleanText(value, 500);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function extractTikhubResearchDescription(record: Record<string, unknown>, desc: string) {
  const chapterAbstract = firstString(record.chapter_abstract);
  const chapterItems = objectArrayAtPath(record, ["chapter_list"])
    .map((item) => firstString(item.desc, item.desc_for_search))
    .filter(Boolean);
  const parts = uniqueTextParts([
    desc,
    chapterAbstract ? `章节摘要：${chapterAbstract}` : "",
    chapterItems.length > 0 ? `章节：${chapterItems.join("；")}` : "",
  ]);
  return cleanText(parts.join("\n"), 1800);
}

function normalizeVideoRecord(
  record: Record<string, unknown>,
  creatorRef: string,
  fetchedAt: string,
  source: DouyinVideoSource = "public_page",
): RawDouyinVideo | null {
  const id = firstString(
    record.aweme_id,
    record.awemeId,
    record.item_id,
    record.itemId,
    record.id,
  );
  const desc = cleanText(firstString(record.desc, record.title, record.caption));
  const description =
    source === "tikhub" ? extractTikhubResearchDescription(record, desc) : desc;
  const videoUrl = normalizeDouyinVideoUrl(
    firstString(record.share_url, record.shareUrl, record.url),
    id,
  );
  if (!id && !videoUrl) return null;
  if (!desc && !videoUrl.includes("/video/")) return null;

  const normalizedId = id || stableVideoId(videoUrl, desc);
  const creatorName = firstString(
    objectAtPath(record, ["author", "nickname"]),
    objectAtPath(record, ["author", "name"]),
    objectAtPath(record, ["user", "nickname"]),
    creatorRef,
  );

  return {
    id: normalizedId,
    creatorRef,
    creatorName: creatorName || creatorRef,
    title: desc || `Douyin video ${normalizedId}`,
    description,
    publishedAt: dateFromUnixSeconds(
      record.create_time ?? record.createTime ?? record.publish_time,
    ),
    videoUrl: normalizeDouyinVideoUrl(videoUrl, normalizedId),
    coverUrl: extractCoverUrl(record) || null,
    source,
    fetchedAt,
  };
}

function collectVideoRecords(
  value: unknown,
  out: RawDouyinVideo[],
  seen: Set<string>,
  creatorRef: string,
  fetchedAt: string,
  source: DouyinVideoSource = "public_page",
  depth = 0,
) {
  if (depth > 12 || !value) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      collectVideoRecords(item, out, seen, creatorRef, fetchedAt, source, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const video = normalizeVideoRecord(record, creatorRef, fetchedAt, source);
  if (video && !seen.has(video.id)) {
    seen.add(video.id);
    out.push(video);
  }

  for (const child of Object.values(record)) {
    collectVideoRecords(child, out, seen, creatorRef, fetchedAt, source, depth + 1);
  }
}

function extractJsonScripts(html: string) {
  const scripts: string[] = [];
  for (const match of html.matchAll(
    /<script[^>]+id=["'](?:RENDER_DATA|SIGI_STATE|__UNIVERSAL_DATA_FOR_REHYDRATION__)["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const content = decodeHtmlEntity(match[1] ?? "").trim();
    if (!content) continue;
    scripts.push(maybeDecodeURIComponent(content));
    scripts.push(content);
  }
  return scripts;
}

function extractRegexVideos(html: string, creatorRef: string, fetchedAt: string) {
  const out: RawDouyinVideo[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(
    /https?:\\?\/\\?\/(?:www\.)?douyin\.com\\?\/video\\?\/(\d+)/gi,
  )) {
    const id = match[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      creatorRef,
      creatorName: creatorRef,
      title: `Douyin video ${id}`,
      description: "",
      publishedAt: null,
      videoUrl: `https://www.douyin.com/video/${id}`,
      coverUrl: null,
      source: "public_page",
      fetchedAt,
    });
  }
  return out;
}

export function extractDouyinVideosFromHtml(
  html: string,
  {
    creatorRef,
    fetchedAt = new Date().toISOString(),
  }: { creatorRef: string; fetchedAt?: string },
): RawDouyinVideo[] {
  const out: RawDouyinVideo[] = [];
  const seen = new Set<string>();

  for (const script of extractJsonScripts(html)) {
    const parsed = parseJsonObject(script);
    if (!parsed) continue;
    collectVideoRecords(parsed, out, seen, creatorRef, fetchedAt);
  }

  for (const video of extractRegexVideos(html, creatorRef, fetchedAt)) {
    if (seen.has(video.id)) continue;
    seen.add(video.id);
    out.push(video);
  }

  return out.slice(0, 50);
}

export function isDouyinAntiBotChallengeHtml(html: string) {
  return (
    /byted_acrawler|__ac_nonce|__ac_signature|window\.location\.reload/i.test(
      html,
    ) &&
    !/aweme_id|awemeId|RENDER_DATA|SIGI_STATE|__UNIVERSAL_DATA_FOR_REHYDRATION__/i.test(
      html,
    )
  );
}

export function isDouyinLoginWallHtml(html: string) {
  const text = decodeHtmlEntity(html).replace(/\s+/g, "");
  return (
    /看更多最新作品|登录查看更多|登录后查看更多|登录后查看/i.test(text) &&
    /登录|login/i.test(text) &&
    !/aweme_id|awemeId|RENDER_DATA|SIGI_STATE|__UNIVERSAL_DATA_FOR_REHYDRATION__/i.test(
      html,
    )
  );
}

function stripCdata(value: string) {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function stripHtmlTags(value: string) {
  return decodeHtmlEntity(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function firstXmlTag(item: string, tag: string) {
  const match = item.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  return match ? stripCdata(decodeHtmlEntity(match[1].trim())) : "";
}

function firstXmlAttribute(item: string, tag: string, attr: string) {
  const match = item.match(new RegExp(`<${tag}\\b([^>]*)>`, "i"));
  if (!match) return "";
  const attrMatch = (match[1] ?? "").match(
    new RegExp(`${attr}=["']([^"']+)["']`, "i"),
  );
  return attrMatch ? decodeHtmlEntity(attrMatch[1].trim()) : "";
}

function parseRssDate(raw: string) {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function idFromDouyinLink(link: string, text: string) {
  const match = link.match(/(?:video|note)\/(\d+)/i);
  return match?.[1] || stableVideoId(link, text);
}

export function parseDouyinRssFeed(
  xml: string,
  {
    creatorRef,
    fetchedAt = new Date().toISOString(),
  }: { creatorRef: string; fetchedAt?: string },
): RawDouyinVideo[] {
  const out: RawDouyinVideo[] = [];
  for (const match of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const item = match[0];
    const title = cleanText(stripHtmlTags(firstXmlTag(item, "title")));
    const link = firstXmlTag(item, "link");
    const description = cleanText(stripHtmlTags(firstXmlTag(item, "description")));
    if (!title && !description && !link) continue;
    const id = idFromDouyinLink(link, [title, description].join("\n"));
    out.push({
      id,
      creatorRef,
      creatorName: firstXmlTag(item, "author") || creatorRef,
      title: title || description || `Douyin video ${id}`,
      description,
      publishedAt: parseRssDate(firstXmlTag(item, "pubDate")),
      videoUrl: link || `https://www.douyin.com/video/${id}`,
      coverUrl: firstString(
        firstXmlAttribute(item, "media:thumbnail", "url"),
        firstXmlAttribute(item, "enclosure", "url"),
      ) || null,
      source: "rsshub",
      fetchedAt,
    });
  }
  return out;
}

export function parseTikhubDouyinVideos(
  payload: unknown,
  {
    creatorRef,
    fetchedAt = new Date().toISOString(),
  }: { creatorRef: string; fetchedAt?: string },
): RawDouyinVideo[] {
  const out: RawDouyinVideo[] = [];
  const seen = new Set<string>();
  const candidates = [
    ...objectArrayAtPath(payload, ["data", "aweme_list"]),
    ...objectArrayAtPath(payload, ["data", "aweme_detail", "aweme_list"]),
    ...objectArrayAtPath(payload, ["aweme_list"]),
  ];
  for (const item of candidates) {
    const video = normalizeVideoRecord(item, creatorRef, fetchedAt, "tikhub");
    if (video && !seen.has(video.id)) {
      seen.add(video.id);
      out.push(video);
    }
  }
  if (out.length === 0) {
    collectVideoRecords(payload, out, seen, creatorRef, fetchedAt, "tikhub");
  }
  return out.slice(0, 50);
}

function keywordAssets(text: string) {
  const upper = text.toUpperCase();
  const tickerAssets = Array.from(upper.matchAll(/\$([A-Z]{1,6})(?=$|[^A-Z0-9])/g))
    .map((match) => match[1])
    .filter(Boolean);
  const aShareMapping: Array<[RegExp, string]> = [
    [/沪电股份|沪电/i, "A股: 沪电股份"],
    [/胜宏科技|胜宏/i, "A股: 胜宏科技"],
    [/生益科技|生益/i, "A股: 生益科技"],
    [/深南电路|深南/i, "A股: 深南电路"],
    [/中际旭创|中际/i, "A股: 中际旭创"],
    [/新易盛/i, "A股: 新易盛"],
    [/天孚通信|天孚/i, "A股: 天孚通信"],
    [/PCB|覆铜板|CCL|胜宏科技|沪电股份|沪电|生益科技|景旺电子|深南电路/i, "A股: PCB/覆铜板"],
    [/CPO|光模块|光通信|新易盛|中际旭创|天孚通信|剑桥科技|太辰光/i, "A股: CPO/光模块"],
    [/存储芯片|长鑫存储|兆易创新|香农芯创|佰维存储|江波龙|北京君正/i, "A股: 存储芯片"],
    [/AI眼镜|消费电子|立讯精密|歌尔股份|蓝思科技/i, "A股: 消费电子"],
    [/机器人|减速器|谐波|绿的谐波|中大力德|三花智控/i, "A股: 机器人"],
    [/半导体|芯片|中芯国际|寒武纪|北方华创|韦尔股份|海光信息/i, "A股: 半导体"],
  ];
  const globalMapping: Array<[RegExp, string]> = [
    [/NVIDIA|英伟达|NVDA/i, "NVDA"],
    [/TSMC|台积电|TSM/i, "TSM"],
    [/AMD|超威/i, "AMD"],
    [/MICRON|美光|MU/i, "MU"],
    [/ARM/i, "ARM"],
    [/光通信|CPO|LITE|COHR|AAOI/i, "光通信"],
    [/数据中心|AI\s*SERVER|算力/i, "AI 数据中心"],
    [/储存|存储|DRAM|HBM|NAND|SSD/i, "存储链"],
    [/美股|NASDAQ|纳斯达克|标普/i, "美股"],
    [/BTC|BITCOIN|比特币/i, "BTC"],
    [/GOOGLE|谷歌|GOOGL|GOOG|TPU|AI\s*ASIC|博通|BROADCOM|AVGO/i, "谷歌TPU/AI ASIC产业链"],
    [/BROADCOM|博通|AVGO/i, "AVGO"],
  ];
  const aShareAssets: string[] = [];
  const globalAssets: string[] = [];
  for (const [pattern, asset] of aShareMapping) {
    if (pattern.test(text)) aShareAssets.push(asset);
  }
  for (const [pattern, asset] of globalMapping) {
    if (pattern.test(text)) globalAssets.push(asset);
  }
  return uniqueStrings([...aShareAssets, ...tickerAssets, ...globalAssets], 10);
}

function inferRecommendationReasons(text: string, assets: string[]) {
  const reasons: string[] = [];
  const assetText = assets.join("\n");
  const combined = [text, assetText].join("\n");
  if (/沪电|PCB|覆铜板|CCL|高阶PCB|A股: PCB\/覆铜板/i.test(combined)) {
    reasons.push(
      "可见文本推断：博主看好/推荐的核心是AI服务器、交换机和光模块需求拉动高阶PCB、覆铜板等链条景气。",
    );
  }
  if (/谷歌|GOOGLE|GOOGL|GOOG|TPU|AI\s*ASIC|博通|BROADCOM|AVGO/i.test(combined)) {
    reasons.push(
      "谷歌TPU/AI ASIC产业链逻辑：谷歌自研AI芯片放量带动博通ASIC、先进封装、服务器PCB和高速互联需求，相关A股需验证是否进入供应链或受益于同类订单外溢。",
    );
  }
  if (/沪电|沪电股份/i.test(combined)) {
    reasons.push(
      "沪电股份被归入高阶PCB受益链条，后续要验证服务器/交换机/光模块PCB订单、产能释放和毛利率变化。",
    );
  }
  if (/CPO|光模块|光通信|中际旭创|新易盛|天孚通信/i.test(combined)) {
    reasons.push(
      "光模块/CPO逻辑来自AI算力扩张和高速互联升级，市场关注订单持续性、价格弹性和上游PCB材料配套。",
    );
  }
  if (/存储芯片|长鑫存储|DRAM|HBM|NAND|SSD/i.test(combined)) {
    reasons.push(
      "存储链逻辑来自涨价、AI服务器存储需求和国产替代，需跟踪报价、库存周期和相关公司订单兑现。",
    );
  }
  if (reasons.length === 0 && assets.length > 0) {
    reasons.push(
      "内容有限：可见文本只提到相关资产，未给出完整推荐理由，需要结合视频口播、字幕或后续资料复核。",
    );
  }
  return uniqueStrings(reasons, 6);
}

export function buildDouyinResearchSummary(
  video: Pick<DouyinVideoRecord, "title" | "description">,
): DouyinVideoSummary {
  const text = cleanText([video.title, video.description].filter(Boolean).join("\n"), 1800);
  const assets = keywordAssets(text);
  const hasAShareContext = assets.some((asset) => asset.startsWith("A股:"));
  const hasTradingLogic = /炒作|逻辑|发酵|预期差|催化|主线|题材|窗口|进攻|格局/.test(text);
  return {
    status: "limited",
    coreView: text
      ? hasAShareContext
        ? `A股/板块/逻辑：${text}`
        : text
      : "公开视频只暴露了有限标题/简介，暂无法提取完整观点。",
    assets,
    recommendationReasons: inferRecommendationReasons(text, assets),
    catalysts:
      assets.length > 0
        ? [
            hasTradingLogic || hasAShareContext
              ? "优先复核视频提到的A股板块炒作逻辑、催化和持续性。"
              : "公开视频提到相关资产或产业链。",
          ]
        : [],
    risks: ["内容来自公开视频可见信息，缺少完整字幕时需要人工复核。"],
    followUps:
      assets.length > 0
        ? assets.map((asset) => `跟踪 ${asset} 后续价格、新闻和财报验证。`)
        : ["等待下一次抓取或补充第三方 API 获取完整文案。"],
  };
}

function normalizeSummary(record: Record<string, unknown>): DouyinVideoSummary {
  const fallback = buildDouyinResearchSummary({
    title: stringValue(record.coreView),
    description: "",
  });
  const status = stringValue(record.status);
  const recommendationReasons = uniqueStrings(
    [
      ...parseStringArray(record.recommendationReasons),
      ...parseStringArray(record.reasons),
      ...parseStringArray(record.thesis),
    ],
    8,
  );
  return {
    status: status === "generated" ? "generated" : fallback.status,
    coreView: stringValue(record.coreView) || fallback.coreView,
    assets: uniqueStrings(parseStringArray(record.assets), 10),
    recommendationReasons:
      recommendationReasons.length > 0 ? recommendationReasons : fallback.recommendationReasons,
    catalysts: uniqueStrings(parseStringArray(record.catalysts), 8),
    risks: uniqueStrings(parseStringArray(record.risks), 8),
    followUps: uniqueStrings(parseStringArray(record.followUps), 8),
    error: typeof record.error === "string" ? record.error : null,
  };
}

function prioritizeResearchSummary(
  summary: DouyinVideoSummary,
  sourceText: string,
): DouyinVideoSummary {
  const priorityAssets = keywordAssets(
    [
      sourceText,
      summary.coreView,
      summary.assets.join("\n"),
      summary.recommendationReasons.join("\n"),
      summary.catalysts.join("\n"),
    ].join("\n"),
  );
  const hasAShareContext = priorityAssets.some((asset) => asset.startsWith("A股:"));
  const recommendationReasons = inferRecommendationReasons(
    [
      sourceText,
      summary.coreView,
      summary.assets.join("\n"),
      summary.recommendationReasons.join("\n"),
      summary.catalysts.join("\n"),
    ].join("\n"),
    priorityAssets,
  );
  return {
    ...summary,
    assets: uniqueStrings([...priorityAssets, ...summary.assets], 10),
    recommendationReasons: uniqueStrings(
      [...recommendationReasons, ...summary.recommendationReasons],
      8,
    ),
    catalysts: hasAShareContext
      ? uniqueStrings(
          [
            "A股板块炒作逻辑：优先复核视频提到的催化、持续性和相关股票。",
            ...summary.catalysts,
          ],
          8,
        )
      : summary.catalysts,
  };
}

function getAiBaseUrl(env: EnvLike) {
  if (env.DEEPSEEK_API_KEY?.trim()) {
    return (env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL).replace(
      /\/+$/,
      "",
    );
  }
  return (
    env.AI_SUMMARY_BASE_URL?.trim() ||
    env.OPENAI_BASE_URL?.trim() ||
    env.MINIMAX_BASE_URL?.trim() ||
    (env.MINIMAX_API_KEY?.trim() ? DEFAULT_MINIMAX_BASE_URL : DEFAULT_OPENAI_BASE_URL)
  ).replace(/\/+$/, "");
}

function getAiApiKey(env: EnvLike) {
  return (
    env.DEEPSEEK_API_KEY?.trim() ||
    env.MINIMAX_API_KEY?.trim() ||
    env.AI_SUMMARY_API_KEY?.trim() ||
    env.OPENAI_API_KEY?.trim() ||
    ""
  );
}

function getAiModel(env: EnvLike) {
  if (env.DEEPSEEK_API_KEY?.trim()) {
    return env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL;
  }
  return (
    env.DOUYIN_AI_MODEL?.trim() ||
    env.AI_SUMMARY_MODEL?.trim() ||
    env.OPENAI_MODEL?.trim() ||
    (env.MINIMAX_API_KEY?.trim() ? DEFAULT_MINIMAX_MODEL : DEFAULT_OPENAI_MODEL)
  );
}

function getAiProviderId(baseUrl: string) {
  return baseUrl.includes("minimax")
    ? "minimax"
    : baseUrl.includes("deepseek")
      ? "deepseek"
      : "openai-compatible";
}

function getDouyinAiProviderCandidates(env: EnvLike): AiProviderConfig[] {
  const baseUrl = getAiBaseUrl(env);
  const primary: AiProviderConfig = {
    id: getAiProviderId(baseUrl),
    baseUrl,
    apiKey: getAiApiKey(env),
    model: getAiModel(env),
  };
  const fallbackApiKey = env.AI_SUMMARY_FALLBACK_API_KEY?.trim() || "";
  const fallbackBaseUrl = (
    env.AI_SUMMARY_FALLBACK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL
  ).replace(/\/+$/, "");
  const fallback: AiProviderConfig = {
    id: getAiProviderId(fallbackBaseUrl),
    baseUrl: fallbackBaseUrl,
    apiKey: fallbackApiKey,
    model: env.AI_SUMMARY_FALLBACK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
  };
  const providers = primary.apiKey ? [primary] : [];
  if (
    fallback.apiKey &&
    !providers.some(
      (provider) =>
        provider.baseUrl === fallback.baseUrl &&
        provider.apiKey === fallback.apiKey &&
        provider.model === fallback.model,
    )
  ) {
    providers.push(fallback);
  }
  return providers;
}

export function parseAiSummaryContent(content: string): DouyinVideoSummary {
  const cleanedBase = content
    .trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const jsonStart = cleanedBase.indexOf("{");
  const jsonEnd = cleanedBase.lastIndexOf("}");
  const cleaned =
    jsonStart >= 0 && jsonEnd > jsonStart
      ? cleanedBase.slice(jsonStart, jsonEnd + 1)
      : cleanedBase;
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return prioritizeResearchSummary(
      normalizeSummary({ ...parsed, status: "generated" }),
      cleanedBase,
    );
  } catch {
    const coreMatch = cleanedBase.match(
      /["']?coreView["']?\s*[:：]\s*["“]?([^"\n,}]+)/i,
    );
    const freeformText = cleanText(
      (coreMatch?.[1] || cleanedBase)
        .replace(/[{}[\]",]/g, " ")
        .replace(/\s+/g, " "),
    );
    return prioritizeResearchSummary(
      {
        ...buildDouyinResearchSummary({
          title: freeformText,
          description: "",
        }),
        status: "generated",
      },
      cleanedBase,
    );
  }
}

async function requestDouyinAiSummary(
  video: RawDouyinVideo,
  env: EnvLike,
): Promise<DouyinVideoSummary> {
  const providers = getDouyinAiProviderCandidates(env);
  if (providers.length === 0) return buildDouyinResearchSummary(video);

  const prompt = `
你是中文投研助理。只基于下面这个抖音公开视频的标题/简介，提取投研信号。
如果信息不足，必须写明“内容有限”，不要编造事实。
摘要优先级必须是：1) 提到的A股具体股票/代码；2) A股板块/产业链；3) 炒作逻辑、催化和持续性；4) 风险点；5) 港美股/币圈等其它资产。
如果标题/简介里出现PCB、覆铜板、CPO、光模块、存储芯片、长鑫存储、机器人、消费电子、半导体等A股线索，要放在 assets 和 catalysts 的最前面。
注意识别A股简称，例如：沪电=沪电股份，胜宏=胜宏科技，生益=生益科技，深南=深南电路，中际=中际旭创，天孚=天孚通信。
注意识别谷歌产业链，例如：谷歌/Google/GOOGL/GOOG/TPU/AI ASIC/博通/Broadcom/AVGO，并说明它与PCB、光模块、服务器和高速互联链条的关系。
必须解释“为什么博主推荐/看好这个股票或板块”：产业逻辑、公司受益环节、催化、预期差、验证点分别是什么；如果可见文本没有给出足够依据，要明确写“内容有限”。

视频:
博主: ${video.creatorName}
标题/简介/章节摘要: ${video.description || video.title}
链接: ${video.videoUrl}

只返回 JSON:
{
  "coreView": "核心观点，一句话；有A股线索时先写A股/板块/逻辑",
  "assets": ["A股股票/代码或A股板块优先，其次其它资产"],
  "recommendationReasons": ["为什么推荐/看好：产业逻辑、公司受益环节、预期差、验证点；不能编造"],
  "catalysts": ["炒作逻辑/催化/持续性"],
  "risks": ["风险点"],
  "followUps": ["可跟踪事项"]
}
`.trim();

  const result = await runWithAiProviderFallback({
    providers,
    cooldownMs: positiveInt(env.AI_SUMMARY_PROVIDER_COOLDOWN_MS, 6 * 60 * 60 * 1000),
    request: async (provider) => {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
        {
          role: "system",
          content: "你输出简洁、可复核的中文投研摘要，只使用用户给出的信息。",
        },
        { role: "user", content: prompt },
          ],
          temperature: 0.2,
          response_format: provider.baseUrl.includes("minimax")
            ? undefined
            : { type: "json_object" },
        }),
        signal: AbortSignal.timeout(positiveInt(env.DOUYIN_AI_TIMEOUT_MS, 60_000)),
      });

      const payload = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!response.ok) {
        const error = payload.error as Record<string, unknown> | undefined;
        throw new Error(
          stringValue(error?.message) || `Douyin AI HTTP ${response.status}`,
        );
      }
      const choices = Array.isArray(payload.choices) ? payload.choices : [];
      const first = choices[0] as Record<string, unknown> | undefined;
      const message = first?.message as Record<string, unknown> | undefined;
      const content = stringValue(message?.content);
      if (!content) throw new Error("Douyin AI summary returned empty content");
      return parseAiSummaryContent(content);
    },
  });
  return result.value;
}

export function getDouyinDbPath(env: EnvLike = process.env) {
  return (
    env.DOUYIN_MONITOR_DB?.trim() ||
    getRuntimeDataPath(env, DEFAULT_DOUYIN_DB)
  );
}

export function getDouyinWorkerIntervalMs(env: EnvLike = process.env) {
  return positiveInt(env.DOUYIN_WORKER_INTERVAL_MS, DEFAULT_REFRESH_INTERVAL_MS);
}

export function initDouyinMonitorDb(db: DatabaseSync) {
  db.exec("pragma journal_mode = wal");
  db.exec("pragma synchronous = normal");
  db.exec("pragma busy_timeout = 5000");
  db.exec(`
    create table if not exists douyin_videos (
      id text primary key,
      creator_ref text not null,
      creator_name text not null,
      title text not null,
      description text not null,
      published_at text,
      video_url text not null,
      cover_url text,
      source text not null,
      fetched_at text not null,
      first_seen_at text not null,
      updated_at text not null,
      summary_json text,
      summary_status text not null default 'pending',
      error text
    )
  `);
  db.exec(`
    create table if not exists douyin_refresh_log (
      id integer primary key autoincrement,
      creator_ref text not null,
      creator_name text,
      status text not null,
      fetched_at text not null,
      inserted integer not null default 0,
      video_count integer not null default 0,
      error text
    )
  `);
}

function openDouyinDb(path = getDouyinDbPath()) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  initDouyinMonitorDb(db);
  return db;
}

function parseStoredSummary(raw: unknown): DouyinVideoSummary | null {
  const parsed = parseJsonObject(raw);
  return parsed ? normalizeSummary(parsed) : null;
}

function rowToVideo(row: DbRow): DouyinVideoRecord {
  return {
    id: stringValue(row.id),
    creatorRef: stringValue(row.creator_ref),
    creatorName: stringValue(row.creator_name),
    title: stringValue(row.title),
    description: stringValue(row.description),
    publishedAt: stringValue(row.published_at) || null,
    videoUrl: stringValue(row.video_url),
    coverUrl: stringValue(row.cover_url) || null,
    source:
      stringValue(row.source) === "rsshub"
        ? "rsshub"
        : stringValue(row.source) === "tikhub"
          ? "tikhub"
          : "public_page",
    fetchedAt: stringValue(row.fetched_at),
    firstSeenAt: stringValue(row.first_seen_at),
    updatedAt: stringValue(row.updated_at),
    summary: parseStoredSummary(row.summary_json),
    summaryStatus:
      stringValue(row.summary_status) === "generated" ||
      stringValue(row.summary_status) === "limited" ||
      stringValue(row.summary_status) === "error"
        ? (stringValue(row.summary_status) as DouyinVideoRecord["summaryStatus"])
        : "pending",
    error: stringValue(row.error) || null,
  };
}

function hasDouyinVideoContentChanged(
  current: DouyinVideoRecord,
  video: RawDouyinVideo,
) {
  return (
    current.creatorRef !== video.creatorRef ||
    current.creatorName !== video.creatorName ||
    current.title !== video.title ||
    current.description !== video.description ||
    current.publishedAt !== video.publishedAt ||
    current.videoUrl !== video.videoUrl ||
    current.coverUrl !== video.coverUrl
  );
}

export function selectDouyinVideosNeedingAiSummary(
  db: DatabaseSync,
  videos: RawDouyinVideo[],
  env: EnvLike = process.env,
) {
  const select = db.prepare("select * from douyin_videos where id = ?");
  const retryErrors = env.DOUYIN_AI_RETRY_ERRORS?.trim().toLowerCase() === "true";
  return videos.filter((video) => {
    const existing = select.get(video.id);
    if (!existing) return true;
    const current = rowToVideo(existing);
    return (
      hasDouyinVideoContentChanged(current, video) ||
      (retryErrors && current.summaryStatus === "error")
    );
  });
}

export function upsertDouyinVideos(db: DatabaseSync, videos: RawDouyinVideo[]) {
  let inserted = 0;
  const select = db.prepare("select * from douyin_videos where id = ?");
  const insert = db.prepare(`
    insert into douyin_videos (
      id, creator_ref, creator_name, title, description, published_at,
      video_url, cover_url, source, fetched_at, first_seen_at, updated_at,
      summary_json, summary_status, error
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    update douyin_videos
    set creator_ref = ?, creator_name = ?, title = ?, description = ?,
        published_at = ?, video_url = ?, cover_url = ?, source = ?,
        fetched_at = ?, updated_at = ?
    where id = ?
  `);

  for (const video of videos) {
    const existing = select.get(video.id);
    const summary = buildDouyinResearchSummary(video);
    const now = video.fetchedAt || new Date().toISOString();
    if (!existing) {
      insert.run(
        video.id,
        video.creatorRef,
        video.creatorName,
        video.title,
        video.description,
        video.publishedAt,
        video.videoUrl,
        video.coverUrl,
        video.source,
        video.fetchedAt,
        now,
        now,
        JSON.stringify(summary),
        summary.status,
        null,
      );
      inserted += 1;
      continue;
    }

    const current = rowToVideo(existing);
    const changed = hasDouyinVideoContentChanged(current, video);
    if (changed) {
      update.run(
        video.creatorRef,
        video.creatorName,
        video.title,
        video.description,
        video.publishedAt,
        video.videoUrl,
        video.coverUrl,
        video.source,
        video.fetchedAt,
        now,
        video.id,
      );
    }
  }
  return inserted;
}

export function listDouyinVideos(
  db: DatabaseSync,
  {
    limit = 50,
    minPublishedAt,
  }: { limit?: number; minPublishedAt?: string | null } = {},
): DouyinVideoRecord[] {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 200));
  const normalizedMinPublishedAt = normalizeIsoDate(minPublishedAt);
  const query = `
      select *
      from douyin_videos
      ${normalizedMinPublishedAt ? "where published_at is not null and published_at >= ?" : ""}
      order by
        case when published_at is null then 1 else 0 end asc,
        published_at desc,
        first_seen_at desc,
        updated_at desc
      limit ?
    `;
  const rows = normalizedMinPublishedAt
    ? (db.prepare(query).all(normalizedMinPublishedAt, boundedLimit) as DbRow[])
    : (db.prepare(query).all(boundedLimit) as DbRow[]);
  return rows.map(rowToVideo);
}

function writeRefreshLog(db: DatabaseSync, result: DouyinRefreshResult) {
  db.prepare(`
    insert into douyin_refresh_log (
      creator_ref, creator_name, status, fetched_at, inserted, video_count, error
    ) values (?, ?, ?, ?, ?, ?, ?)
  `).run(
    result.creatorRef,
    result.creatorName,
    result.status,
    result.fetchedAt,
    result.inserted,
    result.videoCount,
    result.error,
  );
}

function listRefreshErrors(db: DatabaseSync): DouyinRefreshResult[] {
  const rows: DouyinRefreshResult[] = (
    db.prepare(`
      select creator_ref, creator_name, status, fetched_at, inserted, video_count, error
      from douyin_refresh_log
      order by fetched_at desc
      limit 100
    `).all() as DbRow[]
  ).map((row) => ({
    creatorRef: stringValue(row.creator_ref),
    creatorName: stringValue(row.creator_name) || null,
    status:
      stringValue(row.status) === "empty"
        ? "empty"
        : stringValue(row.status) === "error"
          ? "error"
          : "ok",
    fetchedAt: stringValue(row.fetched_at),
    inserted: numberValue(row.inserted),
    videoCount: numberValue(row.video_count),
    error: stringValue(row.error) || null,
  }));
  return collapseDouyinRefreshErrors(rows).slice(0, 10);
}

export function collapseDouyinRefreshErrors(
  results: DouyinRefreshResult[],
): DouyinRefreshResult[] {
  const sorted = [...results]
    .sort((left, right) => {
      const rightTime = Date.parse(right.fetchedAt) || 0;
      const leftTime = Date.parse(left.fetchedAt) || 0;
      return rightTime - leftTime;
    });
  const seen = new Set<string>();
  const out: DouyinRefreshResult[] = [];
  for (const result of sorted) {
    const key = result.creatorRef.trim().toLowerCase() || result.creatorName || "unknown";
    if (seen.has(key)) continue;
    seen.add(key);
    if (result.status !== "ok") out.push(result);
  }
  return out;
}

function latestRefreshAt(db: DatabaseSync) {
  const row = db
    .prepare("select fetched_at from douyin_refresh_log order by fetched_at desc limit 1")
    .get();
  return row ? stringValue(row.fetched_at) || null : null;
}

function resolveCreatorUrl(ref: string) {
  const trimmed = ref.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^MS4wLj/i.test(trimmed)) return `https://www.douyin.com/user/${trimmed}`;
  return `https://www.douyin.com/search/${encodeURIComponent(trimmed)}`;
}

function extractDouyinUserId(ref: string) {
  const trimmed = ref.trim();
  try {
    const parsed = new URL(resolveCreatorUrl(trimmed));
    const segments = parsed.pathname.split("/").filter(Boolean);
    const userIndex = segments.findIndex((segment) => segment.toLowerCase() === "user");
    if (userIndex >= 0 && segments[userIndex + 1]) {
      return decodeURIComponent(segments[userIndex + 1]);
    }
    return segments.at(-1) ? decodeURIComponent(segments.at(-1) ?? "") : trimmed;
  } catch {
    return trimmed.replace(/^@/, "");
  }
}

function resolveRssHubUrl(creatorRef: string, env: EnvLike) {
  const base = env.DOUYIN_RSSHUB_BASE_URL?.trim();
  if (!base) return null;
  const userId = extractDouyinUserId(creatorRef);
  if (!userId) return null;
  return `${base.replace(/\/+$/, "")}/douyin/user/${encodeURIComponent(userId)}`;
}

function getTikhubApiKey(env: EnvLike) {
  return env.DOUYIN_TIKHUB_API_KEY?.trim() || env.TIKHUB_API_KEY?.trim() || "";
}

function resolveTikhubUrl(creatorRef: string, env: EnvLike) {
  const base = (env.DOUYIN_TIKHUB_BASE_URL?.trim() || DEFAULT_TIKHUB_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const path = env.DOUYIN_TIKHUB_USER_POSTS_PATH?.trim() || DEFAULT_TIKHUB_USER_POSTS_PATH;
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  url.searchParams.set("sec_user_id", extractDouyinUserId(creatorRef));
  url.searchParams.set("max_cursor", "0");
  url.searchParams.set(
    "count",
    String(Math.min(20, positiveInt(env.DOUYIN_FETCH_LIMIT, DEFAULT_FETCH_LIMIT))),
  );
  if (path.includes("/web/")) {
    url.searchParams.set("filter_type", env.DOUYIN_TIKHUB_FILTER_TYPE?.trim() || "0");
    const cookie = env.DOUYIN_COOKIE?.trim();
    if (cookie) url.searchParams.set("cookie", cookie);
  } else {
    url.searchParams.set("sort_type", env.DOUYIN_TIKHUB_SORT_TYPE?.trim() || "0");
  }
  return url;
}

function tikhubErrorMessage(payload: unknown) {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
  if (!record) return "";
  return firstString(
    objectAtPath(record, ["detail", "message_zh"]),
    objectAtPath(record, ["detail", "message"]),
    record.message,
    record.msg,
    record.detail,
    objectAtPath(record, ["data", "message_zh"]),
    objectAtPath(record, ["data", "message"]),
    objectAtPath(record, ["data", "msg"]),
  );
}

async function fetchDouyinTikhubVideos({
  creatorRef,
  env,
  fetchedAt,
}: {
  creatorRef: string;
  env: EnvLike;
  fetchedAt: string;
}) {
  const apiKey = getTikhubApiKey(env);
  if (!apiKey) {
    throw new Error("DOUYIN_TIKHUB_API_KEY is not configured");
  }
  const response = await fetch(resolveTikhubUrl(creatorRef, env), {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "SignalHub/1.0 (+https://signal-hub.local)",
    },
    signal: AbortSignal.timeout(positiveInt(env.DOUYIN_FETCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(`TikHub Douyin HTTP ${response.status}: ${tikhubErrorMessage(payload)}`);
  }
  const code =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? numberValue((payload as Record<string, unknown>).code)
      : 0;
  if (code && code !== 200) {
    throw new Error(`TikHub Douyin API ${code}: ${tikhubErrorMessage(payload)}`);
  }
  return parseTikhubDouyinVideos(payload, { creatorRef, fetchedAt }).slice(
    0,
    positiveInt(env.DOUYIN_FETCH_LIMIT, DEFAULT_FETCH_LIMIT),
  );
}

async function fetchDouyinRssHubVideos({
  creatorRef,
  env,
  fetchedAt,
}: {
  creatorRef: string;
  env: EnvLike;
  fetchedAt: string;
}) {
  const url = resolveRssHubUrl(creatorRef, env);
  if (!url) {
    throw new Error("DOUYIN_RSSHUB_BASE_URL is not configured");
  }
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
      "User-Agent":
        env.DOUYIN_USER_AGENT?.trim() ||
        "SignalHub/1.0 (+https://signal-hub.local)",
    },
    signal: AbortSignal.timeout(positiveInt(env.DOUYIN_FETCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)),
  });
  if (!response.ok) {
    throw new Error(`Douyin RSSHub HTTP ${response.status}`);
  }
  const xml = await response.text();
  return parseDouyinRssFeed(xml, { creatorRef, fetchedAt }).slice(
    0,
    positiveInt(env.DOUYIN_FETCH_LIMIT, DEFAULT_FETCH_LIMIT),
  );
}

export async function fetchDouyinCreatorVideos({
  creatorRef,
  env = process.env,
  fetchedAt = new Date().toISOString(),
}: {
  creatorRef: string;
  env?: EnvLike;
  fetchedAt?: string;
}): Promise<RawDouyinVideo[]> {
  if (
    env.DOUYIN_PROVIDER?.trim().toLowerCase() === "tikhub" ||
    getTikhubApiKey(env)
  ) {
    return fetchDouyinTikhubVideos({ creatorRef, env, fetchedAt });
  }

  if (
    env.DOUYIN_PROVIDER?.trim().toLowerCase() === "rsshub" ||
    env.DOUYIN_RSSHUB_BASE_URL?.trim()
  ) {
    return fetchDouyinRssHubVideos({ creatorRef, env, fetchedAt });
  }

  const url = resolveCreatorUrl(creatorRef);
  const headers: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "User-Agent":
      env.DOUYIN_USER_AGENT?.trim() ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 SignalHub/1.0",
  };
  const cookie = env.DOUYIN_COOKIE?.trim();
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(url, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(positiveInt(env.DOUYIN_FETCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)),
  });
  if (!response.ok) {
    throw new Error(`Douyin public page HTTP ${response.status}`);
  }
  const html = await response.text();
  if (isDouyinAntiBotChallengeHtml(html)) {
    throw new Error(
      "Douyin returned an anti-bot signature challenge page. Static public-page fetch cannot read the video list; configure DOUYIN_RSSHUB_BASE_URL or a third-party provider.",
    );
  }
  if (isDouyinLoginWallHtml(html)) {
    throw new Error(
      cookie
        ? "Douyin still shows a login wall. DOUYIN_COOKIE may be expired or insufficient; use RSSHub or a third-party provider for stable monitoring."
        : "Douyin requires login to view latest videos for this profile. Configure DOUYIN_COOKIE, RSSHub, or a third-party provider.",
    );
  }
  return extractDouyinVideosFromHtml(html, { creatorRef, fetchedAt }).slice(
    0,
    positiveInt(env.DOUYIN_FETCH_LIMIT, DEFAULT_FETCH_LIMIT),
  );
}

async function summarizeVideosWithAi(
  db: DatabaseSync,
  videos: RawDouyinVideo[],
  env: EnvLike,
) {
  if (env.DOUYIN_AI_SUMMARY_ENABLED?.trim().toLowerCase() === "false") return;
  const update = db.prepare(`
    update douyin_videos
    set summary_json = ?, summary_status = ?, error = ?, updated_at = ?
    where id = ?
  `);
  for (const video of videos.slice(0, positiveInt(env.DOUYIN_AI_SUMMARY_LIMIT, 6))) {
    try {
      const summary = await requestDouyinAiSummary(video, env);
      update.run(
        JSON.stringify(summary),
        summary.status,
        summary.error ?? null,
        new Date().toISOString(),
        video.id,
      );
    } catch (error) {
      const fallback = {
        ...buildDouyinResearchSummary(video),
        status: "error" as const,
        error: error instanceof Error ? error.message : String(error),
      };
      update.run(
        JSON.stringify(fallback),
        fallback.status,
        fallback.error,
        new Date().toISOString(),
        video.id,
      );
    }
  }
}

export async function refreshDouyinMonitor({
  env = process.env,
  creators,
}: {
  env?: EnvLike;
  creators?: RuntimeWatchItem[];
} = {}): Promise<DouyinSnapshot> {
  const config = await loadRuntimeConfig();
  const activeCreators = (creators ?? config.douyinCreators).filter((item) =>
    item.ref.trim(),
  );
  const db = openDouyinDb(getDouyinDbPath(env));
  const results: DouyinRefreshResult[] = [];
  try {
    for (const creator of activeCreators) {
      const fetchedAt = new Date().toISOString();
      try {
        const videos = await fetchDouyinCreatorVideos({
          creatorRef: creator.ref,
          env,
          fetchedAt,
        });
        const summaryCandidates = selectDouyinVideosNeedingAiSummary(db, videos, env);
        const inserted = upsertDouyinVideos(db, videos);
        await summarizeVideosWithAi(db, summaryCandidates, env);
        const result: DouyinRefreshResult = {
          creatorRef: creator.ref,
          creatorName: videos[0]?.creatorName ?? null,
          status: videos.length > 0 ? "ok" : "empty",
          fetchedAt,
          inserted,
          videoCount: videos.length,
          error:
            videos.length > 0
              ? null
              : "公开页面未返回可解析视频；如果该博主主页被反爬保护，请配置 DOUYIN_RSSHUB_BASE_URL 或第三方 provider。",
        };
        writeRefreshLog(db, result);
        results.push(result);
      } catch (error) {
        const result: DouyinRefreshResult = {
          creatorRef: creator.ref,
          creatorName: null,
          status: "error",
          fetchedAt,
          inserted: 0,
          videoCount: 0,
          error: error instanceof Error ? error.message : String(error),
        };
        writeRefreshLog(db, result);
        results.push(result);
      }
    }
  } finally {
    db.close();
  }
  return getDouyinSnapshot({ env, refreshResults: results });
}

export async function getDouyinSnapshot({
  env = process.env,
  refreshResults,
}: {
  env?: EnvLike;
  refreshResults?: DouyinRefreshResult[];
} = {}): Promise<DouyinSnapshot> {
  const config = await loadRuntimeConfig();
  const db = openDouyinDb(getDouyinDbPath(env));
  try {
    const videos = listDouyinVideos(db, {
      limit: positiveInt(env.DOUYIN_SNAPSHOT_LIMIT, 80),
      minPublishedAt: env.DOUYIN_MIN_PUBLISHED_AT,
    });
    const errors = refreshResults
      ? collapseDouyinRefreshErrors(refreshResults)
      : listRefreshErrors(db);
    const configured = config.douyinCreators.length > 0;
    const hasError = errors.some((result) => result.status === "error");
    const hasOk = videos.length > 0;
    return {
      success: true,
      configured,
      status: !configured
        ? "empty"
        : hasOk && hasError
          ? "partial"
          : hasError
            ? "error"
            : hasOk
              ? "ok"
              : "empty",
      generatedAt: new Date().toISOString(),
      lastUpdatedAt: latestRefreshAt(db),
      creators: config.douyinCreators,
      videos,
      errors,
    };
  } finally {
    db.close();
  }
}
