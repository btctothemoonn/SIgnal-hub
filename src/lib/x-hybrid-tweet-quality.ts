import type { TwitterFeedItem, TwitterQuotedTweet } from "./6551-twitter.ts";

export type TweetFetchQuality = {
  complete: boolean;
  reason:
    | "complete"
    | "main-text-incomplete"
    | "quoted-text-incomplete";
};

function hasTruncationMarker(text: string): boolean {
  const trimmed = text.trim();
  return (
    /\.\.\.\s*(?:https?:\/\/\S+)?$/i.test(trimmed) ||
    /…\s*(?:https?:\/\/\S+)?$/i.test(trimmed)
  );
}

function hasUnbalancedTerminalPunctuation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const quoteCount = (trimmed.match(/"/g) || []).length;
  const apostropheCount = (trimmed.match(/'/g) || []).length;
  if (quoteCount % 2 === 1 || apostropheCount % 2 === 1) return true;
  const pairs: Array<[string, string]> = [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ["“", "”"],
    ["‘", "’"],
  ];
  return pairs.some(([open, close]) => {
    const opens = (trimmed.match(new RegExp(`\\${open}`, "g")) || []).length;
    const closes = (trimmed.match(new RegExp(`\\${close}`, "g")) || []).length;
    return opens > closes;
  });
}

function endsWithDanglingConnector(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /\b(?:and|or|but|with|for|to|of|from|into|about|because|that|which|who|when|while|whereas)\s*$/i.test(trimmed)
    || /(?:和|与|及|但|而且|因为|所以|如果|以及|还有|并且|对于)\s*$/u.test(trimmed);
}

export function isLikelyAbruptlyCutText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (hasTruncationMarker(trimmed)) return true;
  if (hasUnbalancedTerminalPunctuation(trimmed)) return true;
  if (endsWithDanglingConnector(trimmed)) return true;
  if (trimmed.length < 80) return false;
  if (/[.!?。！？…"'”’）)\]】]$/u.test(trimmed)) return false;
  if (/\shttps?:\/\/\S+$/i.test(trimmed)) return true;
  return /[A-Za-z0-9,@$)\]]$/u.test(trimmed);
}

export function isCompleteReferencedTweet(
  quotedTweet: Pick<TwitterQuotedTweet, "id" | "text" | "media"> | null | undefined,
): boolean {
  const text = quotedTweet?.text?.trim() ?? "";
  return Boolean(
    quotedTweet?.id &&
      ((text && !isLikelyAbruptlyCutText(text)) || (quotedTweet.media?.length ?? 0) > 0),
  );
}

export function summarizeTweetFetchQuality(feedItem: TwitterFeedItem): TweetFetchQuality {
  if (!feedItem.text.trim() || isLikelyAbruptlyCutText(feedItem.text)) {
    return {
      complete: false,
      reason: "main-text-incomplete",
    };
  }
  if (feedItem.quotedTweet && !isCompleteReferencedTweet(feedItem.quotedTweet)) {
    return {
      complete: false,
      reason: "quoted-text-incomplete",
    };
  }
  return {
    complete: true,
    reason: "complete",
  };
}
