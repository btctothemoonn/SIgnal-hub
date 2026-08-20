export type StocksEarningsSourceConfig = {
  secCik: string | null;
  officialIrUrls: string[];
  earningsLabsTicker: string;
  chartmillTicker: string;
};

const SEC_CIKS: Readonly<Record<string, string>> = Object.freeze({
  NVDA: "0001045810",
  TSM: "0001046179",
  ASML: "0000937966",
  AMD: "0000002488",
  ARM: "0001973239",
  INTC: "0000050863",
  AVGO: "0001730168",
  LRCX: "0000707549",
  MU: "0000723125",
  WDC: "0000106040",
  SNDK: "0002023554",
  STX: "0001137789",
  COHR: "0000820318",
  LITE: "0001633978",
  IPGP: "0001111928",
  FN: "0001408710",
  CIEN: "0000936395",
  GLW: "0000024741",
  MSFT: "0000789019",
  AMZN: "0001018724",
  GOOG: "0001652044",
  ORCL: "0001341439",
  NOW: "0001373715",
  SNOW: "0001640147",
  PLTR: "0001321655",
  DELL: "0001571996",
  VRT: "0001674101",
  CLS: "0001030894",
  CRWV: "0001769628",
  NBIS: "0001513845",
});

const OFFICIAL_IR_URLS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    NVDA: ["https://investor.nvidia.com/events-and-presentations/default.aspx"],
    AMD: ["https://ir.amd.com/news-events/ir-calendar"],
    INTC: ["https://www.intc.com/news-events/ir-calendar"],
    AVGO: ["https://investors.broadcom.com/events-and-presentations"],
    LRCX: ["https://investor.lamresearch.com/events-and-presentations"],
    MU: ["https://investors.micron.com/events-and-presentations"],
    MSFT: ["https://www.microsoft.com/en-us/Investor/events/default.aspx"],
    AMZN: ["https://ir.aboutamazon.com/events/default.aspx"],
    GOOG: ["https://abc.xyz/investor/events/"],
    ORCL: ["https://investor.oracle.com/events-and-presentations/default.aspx"],
  });

export function getStocksEarningsSourceConfig(
  ticker: string,
): StocksEarningsSourceConfig {
  const normalized = ticker.trim().toUpperCase();
  const isKoreanListing = /\.KS$/.test(normalized);
  return {
    secCik: isKoreanListing ? null : SEC_CIKS[normalized] ?? null,
    officialIrUrls: isKoreanListing
      ? []
      : [...(OFFICIAL_IR_URLS[normalized] ?? [])],
    earningsLabsTicker: normalized.replace(/\.KS$/, ""),
    chartmillTicker: normalized.replace(/\.KS$/, ""),
  };
}
