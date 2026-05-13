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

assert.equal(
  isUsefulTranslation(
    "1/ Meet Dritan Kapllani Jr, a US based threat actor tied to $19M from social engineering thefts targeting crypto holders.\n\nDritan flexes luxury cars, watches, private jets, & clubs all over social media.\n\nRecently he was recorded on a call showing off a wallet with stolen funds.",
    note("RT @zachxbt:1/ 见到美国威胁演员小Dritan Kapllani,"),
  ),
  false,
);

assert.equal(
  isUsefulTranslation(
    "1/ Meet Dritan Kapllani Jr, a US based threat actor tied to $19M from social engineering thefts targeting crypto holders.\n\nDritan flexes luxury cars, watches, private jets, & clubs all over social media.\n\nRecently he was recorded on a call showing off a wallet with stolen funds.",
    note(
      "1/ 来认识一下 Dritan Kapllani Jr，他是一名来自美国的威胁行为者，通过针对加密货币持有者的社会工程盗窃获得了 1900 万美元的损失。\n\nDritan 在社交媒体上展示豪华汽车、手表、私人飞机和俱乐部。\n\n最近，他在一次通话中被录音，展示了一个装有被盗资金的钱包。",
    ),
  ),
  true,
);

console.log("ok - translation quality suppresses redundant translations");
