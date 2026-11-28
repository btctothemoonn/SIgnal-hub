export type TranslationQualityNote = {
  text?: string | null;
};

function comparableText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\s\p{Punctuation}\p{Symbol}]+/gu, "")
    .trim();
}

function startsWithRetweetMarker(text: string): boolean {
  return /^\s*RT\s+@[\w_]+/i.test(text);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cashtags(text: string): string[] {
  const matches = text.match(/\$[A-Za-z][A-Za-z0-9_]{1,15}\b/g) ?? [];
  return [...new Set(matches.map((tag) => tag.toUpperCase()))];
}

function hasMissingCashtag(sourceText: string, translatedText: string): boolean {
  return cashtags(sourceText).some((tag) => {
    const ticker = tag.slice(1);
    return !new RegExp(`\\$?${escapeRegExp(ticker)}\\b`, "i").test(
      translatedText,
    );
  });
}

function meaningfulSourceTokens(text: string): string[] {
  return [
    ...new Set(
      text
        .normalize("NFKC")
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/@\w+/g, " ")
        .replace(/\$[a-z][a-z0-9_]{1,15}\b/g, " ")
        .match(/\p{Letter}[\p{Letter}\p{Number}'-]{2,}/gu) ?? [],
    ),
  ].filter((token) => !/^\d+$/.test(token));
}

// Han text is roughly 1.5 characters per English word, so raw character counts
// make a complete Chinese translation of English look ~4x too short. When a
// Latin-script source becomes a Han-script translation, compare both sides in
// approximate English-word units instead.
const HAN_CHARS_PER_WORD = 1.5;

function lengthUnits(text: string) {
  const plain = text
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/@\w+/g, " ")
    .replace(/\$[A-Za-z][A-Za-z0-9_]{1,15}\b/g, " ");
  const han = (plain.match(/\p{Script=Han}/gu) ?? []).length;
  const latinWords = (plain.match(/\p{Script=Latin}+(?:['’]\p{Script=Latin}+)*/gu) ?? []).length;
  const latinLetters = (plain.match(/\p{Script=Latin}/gu) ?? []).length;
  return { han, latinWords, latinLetters, words: latinWords + han / HAN_CHARS_PER_WORD };
}

function isLatinToHanTranslation(source: ReturnType<typeof lengthUnits>, translated: ReturnType<typeof lengthUnits>) {
  return source.latinLetters > source.han * 2 && translated.han >= translated.latinLetters / 2 && translated.han > 0;
}

function isClearlyIncompleteTranslation(
  sourceText: string,
  translatedText: string,
): boolean {
  if (startsWithRetweetMarker(translatedText) && !startsWithRetweetMarker(sourceText)) {
    return true;
  }

  const sourceLength = comparableText(sourceText).length;
  const translatedLength = comparableText(translatedText).length;
  const sourceUnits = lengthUnits(sourceText);
  const translatedUnits = lengthUnits(translatedText);
  if (isLatinToHanTranslation(sourceUnits, translatedUnits)) {
    if (sourceLength < 120 && meaningfulSourceTokens(sourceText).length < 8) return false;
    // Han already present in the source (bilingual posts) needs no translation,
    // so only the Latin words set the expected translation length.
    return translatedUnits.words < sourceUnits.latinWords * (sourceLength < 120 ? 0.65 : 0.5);
  }
  if (sourceLength < 120) {
    const sourceTokens = meaningfulSourceTokens(sourceText);
    if (sourceTokens.length >= 8 && translatedLength < sourceLength * 0.32) {
      return true;
    }

    return false;
  }

  return translatedLength < sourceLength * 0.25;
}

const FOREIGN_SCRIPT = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Greek}\p{Script=Hangul}]/u;

export function shouldTranslateText(text: string): boolean {
  const semantic = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/@\w+/g, " ")
    .replace(/\$[A-Za-z][A-Za-z0-9_]{1,15}\b/g, " ")
    // Wallet/contract addresses are hex, not language.
    .replace(/\b0x[0-9a-fA-F]{6,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Hashtags alone (e.g. "现场见呀 #BinanceBlockchainWeek") are not a reason to
  // translate: some foreign text must remain outside them.
  if (!FOREIGN_SCRIPT.test(semantic.replace(/#[\p{L}\p{N}_]+/gu, " "))) {
    return false;
  }
  const minimumSemanticLength = /\p{Script=Hangul}/u.test(semantic) ? 3 : 6;
  if (semantic.length < minimumSemanticLength) {
    return false;
  }

  const hanMatches = semantic.match(/\p{Script=Han}/gu) ?? [];
  const letterMatches = semantic.match(/\p{Letter}/gu) ?? [];

  if (letterMatches.length === 0) {
    return false;
  }

  if (hanMatches.length > 0 && hanMatches.length / letterMatches.length >= 0.35) {
    return false;
  }

  return FOREIGN_SCRIPT.test(semantic);
}

export function isUsefulTranslation<T extends TranslationQualityNote>(
  sourceText: string,
  translation: T | null | undefined,
): translation is T {
  const translated = translation?.text?.trim() || "";
  if (!translated) return false;
  if (!shouldTranslateText(sourceText)) return false;

  const sourceComparable = comparableText(sourceText);
  const translatedComparable = comparableText(translated);
  if (!sourceComparable || !translatedComparable) return false;
  if (sourceComparable === translatedComparable) return false;
  if (hasMissingCashtag(sourceText, translated)) return false;
  return !isClearlyIncompleteTranslation(sourceText, translated);
}
