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

function isClearlyIncompleteTranslation(
  sourceText: string,
  translatedText: string,
): boolean {
  if (startsWithRetweetMarker(translatedText) && !startsWithRetweetMarker(sourceText)) {
    return true;
  }

  const sourceLength = comparableText(sourceText).length;
  const translatedLength = comparableText(translatedText).length;
  if (sourceLength < 120) {
    return false;
  }

  return translatedLength < sourceLength * 0.25;
}

export function shouldTranslateText(text: string): boolean {
  const compact = text.replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
  if (compact.length < 6) {
    return false;
  }

  const hanMatches = compact.match(/\p{Script=Han}/gu) ?? [];
  const letterMatches = compact.match(/\p{Letter}/gu) ?? [];

  if (letterMatches.length === 0) {
    return false;
  }

  if (hanMatches.length > 0 && hanMatches.length / letterMatches.length >= 0.35) {
    return false;
  }

  return /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Greek}]/u.test(
    compact,
  );
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
