import assert from "node:assert/strict";
import { isUsefulTranslation, shouldTranslateText } from "./translation-quality.ts";

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
    'JUST IN: Drake mentions Bitcoin in new song. "I\'m a $BTC crypto big-timer."',
    note("\u6700\u65b0\u6d88\u606f\uff1a\u51f5entity"),
  ),
  false,
);

assert.equal(
  isUsefulTranslation(
    "@Naeven_0 Yesterday was my first worst experience of it.. I never care in the past",
    note("@Naeven_0 昨天是我第一次最糟糕的经历。"),
  ),
  false,
);

assert.equal(
  isUsefulTranslation(
    "@SpecterAnalyst Going through the same phase, its so bad one wants to just delete the app lol",
    note("@SpecterAnalyst 经历同样的阶段，"),
  ),
  false,
);

assert.equal(
  isUsefulTranslation(
    "JUST IN: US House passes bill to limit large investors from buying up single-family homes.",
    note(
      "\u6700\u65b0\u6d88\u606f\uff1a\u7f8e\u56fd\u4f17\u8bae\u9662\u901a\u8fc7\u6cd5\u6848\uff0c\u9650\u5236\u5927\u578b\u6295\u8d44\u8005\u8d2d\u4e70\u72ec\u680b\u4f4f\u5b85\u3002",
    ),
  ),
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

assert.equal(shouldTranslateText("@ethy_agent @Mute_swap @virtuals_io 👀"), false);
assert.equal(
  shouldTranslateText("@Artistkatty_ @fore_gate \u98ce\u518d\u5927\u4e00\u70b9\u8c22\u8c22"),
  false,
);
assert.equal(
  shouldTranslateText(
    "@SidkMena I don't have positions anymore, so no comment there.",
  ),
  true,
);
assert.equal(shouldTranslateText("@WhitePeach 인사말 궁금...!"), true);
assert.equal(shouldTranslateText("@WhitePeach 인사말 젤"), true);
assert.equal(
  isUsefulTranslation(
    "@WhitePeach 인사말 궁금...!",
    note("@WhitePeach 想知道问候语……！"),
  ),
  true,
);

// Complete Chinese translations of short English posts are ~4x shorter in characters.
assert.equal(
  isUsefulTranslation(
    "Is there a chance the Korean stock market gets hit with another circuit breaker tomorrow?",
    note("韩国股市明天会不会再次触发熔断机制？"),
  ),
  true,
);
assert.equal(
  isUsefulTranslation(
    "We'll soon shift back from worrying about excessively high oil prices to worrying about excessively high bond yields.",
    note("我们很快就会从担忧油价过高转为担忧债券收益率过高。"),
  ),
  true,
);
assert.equal(
  isUsefulTranslation(
    "We'll soon shift back from worrying about excessively high oil prices to worrying about excessively high bond yields.",
    note("我们很快就会从担忧油价"),
  ),
  false,
);
// Bilingual sources: only the English part needs to be covered.
assert.equal(
  isUsefulTranslation(
    "Tradfin: *LEAVITT: IRAN TO COME UP IN TRUMP SPEECH TONIGHT Tradfin: *LEAVITT: 伊朗将在特朗普今晚的演讲中被提及",
    note("Tradfin：*LEAVITT：伊朗将在特朗普今晚的演讲中被提及"),
  ),
  true,
);
// Hashtags alone and wallet addresses are not language that needs translation.
assert.equal(shouldTranslateText("现场见呀😁 #BinanceBlockchainWeek https://t.co/suEJQGsxri"), false);
assert.equal(shouldTranslateText("0x523611ed006ef9b16f3315e36ea427fceb36ffff"), false);
assert.equal(shouldTranslateText("这是好东西 0x923398cc7d149d69b9356c1866b8d3e9d5cfffff"), false);
assert.equal(shouldTranslateText("Bitcoin breaks out to a new high #BTC"), true);
assert.equal(
  shouldTranslateText("🌟监控到新推文\n你关注的用户: Lookonchain(备注:Lookonchain)\n用户所属分组: 默认分组\n推文内容: Whale 0xe271 bought 39,018 $AAVE ($6.3M) from #Kraken 4 hours ago."),
  true,
);

console.log("ok - translation quality suppresses redundant translations");
