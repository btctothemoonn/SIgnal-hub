import {
  isTelegramXSourceChannel,
  type TelegramXSourceLike,
} from "./telegram-x-source-channels.ts";

export function selectTelegramXSourceRows<T extends TelegramXSourceLike>(
  rows: T[],
  keys: Set<string>,
  limit: number,
) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : rows.length;
  return rows
    .filter((row) =>
      isTelegramXSourceChannel(
        {
          ref: row.ref,
          username: row.username,
          channelUsername: row.channelUsername ?? row.channel_username,
          channelId: row.channelId ?? row.channel_id,
          channel_id: row.channel_id,
          title: row.title,
          channelTitle: row.channelTitle ?? row.channel_title,
        },
        keys,
      ),
    )
    .slice(0, safeLimit);
}
