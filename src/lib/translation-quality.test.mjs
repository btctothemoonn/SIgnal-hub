import assert from "node:assert/strict";
import { isUsefulTranslation } from "./translation-quality.ts";

function note(text) {
  return {
    provider: "985monitor",
    sourceLanguage: "auto",
    targetLanguage: "zh-CN",
    text,
  };
}

assert.equal(
  isUsefulTranslation(
    "现在 NVDA 的股价，已经是在 AI 算力资产和风险折价之间平衡出来的价格。",
    note("现在 NVDA 的股价，已经是在 AI 算力资产和风险折价之间平衡出来的价格。"),
  ),
  false,
);

assert.equal(
  isUsefulTranslation("@ShuYu622 安逸", {
    ...note("@ ShuYu622 安逸"),
    provider: "mymemory",
  }),
  false,
);

assert.equal(
  isUsefulTranslation("Sell it all.", note("全部卖掉。")),
  true,
);

assert.equal(
  isUsefulTranslation(
    "RT @CryptoSylar: The barbell of AI <> Memetics is what makes $SOL a Gem.",
    {
      ...note("转发 @CryptoSylar：AI 与迷因的杠铃结构让 $SOL 成为宝石。"),
      provider: "google-web",
    },
  ),
  true,
);

console.log("ok - translation quality suppresses redundant translations");
