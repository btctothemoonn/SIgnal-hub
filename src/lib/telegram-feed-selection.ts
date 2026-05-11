export type TelegramFeedSelectionItem = {
  id: string;
  channelRef: string;
  channelTitle: string;
  channelUsername: string;
  channelId: string;
  text: string;
  createdAt: string;
};

export function isPriorityTelegramFeedItem(
  item: TelegramFeedSelectionItem,
  priorityMatchers: string[],
): boolean {
  const haystack = [
    item.channelRef,
    item.channelTitle,
    item.channelUsername,
    item.channelId,
    item.text.startsWith("🌟监控到新推文") ? "6551" : "",
  ]
    .join("\n")
    .toLowerCase();

  return priorityMatchers.some((matcher) => {
    const needle = matcher.trim().toLowerCase();
    return needle.length > 0 && haystack.includes(needle);
  });
}

function sortByCreatedAtDesc<T extends TelegramFeedSelectionItem>(items: T[]) {
  return [...items].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function uniqueById<T extends TelegramFeedSelectionItem>(items: T[]) {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(item.id, item);
  }
  return [...map.values()];
}

export function selectTelegramFeed<T extends TelegramFeedSelectionItem>(
  feed: T[],
  options: {
    limit: number;
    priorityMatchers?: string[];
  },
): T[] {
  const limit = Math.max(0, options.limit);
  if (limit === 0) {
    return [];
  }

  const deduped = uniqueById(feed);
  const priorityMatchers = options.priorityMatchers ?? [];
  const priority = sortByCreatedAtDesc(
    deduped.filter((item) => isPriorityTelegramFeedItem(item, priorityMatchers)),
  );
  const regular = sortByCreatedAtDesc(
    deduped.filter((item) => !isPriorityTelegramFeedItem(item, priorityMatchers)),
  );

  return sortByCreatedAtDesc([...priority, ...regular].slice(0, limit));
}
