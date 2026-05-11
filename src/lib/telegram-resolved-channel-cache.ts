export type ResolvedTelegramChannelCache<TChannel> = {
  channels: TChannel[];
  loadedAt: number;
};

type ApplyResolvedTelegramChannelRefreshInput<TChannel> = {
  previous: ResolvedTelegramChannelCache<TChannel> | null;
  channels: TChannel[];
  errors: string[];
  targetCount: number;
  now: number;
};

type ApplyResolvedTelegramChannelRefreshResult<TChannel> = {
  cache: ResolvedTelegramChannelCache<TChannel> | null;
  channels: TChannel[];
  errors: string[];
  usedStaleCache: boolean;
};

export function applyResolvedTelegramChannelRefresh<TChannel>({
  previous,
  channels,
  errors,
  targetCount,
  now,
}: ApplyResolvedTelegramChannelRefreshInput<TChannel>): ApplyResolvedTelegramChannelRefreshResult<TChannel> {
  if (channels.length > 0 || targetCount === 0) {
    const cache = { channels, loadedAt: now };
    return {
      cache,
      channels,
      errors,
      usedStaleCache: false,
    };
  }

  if (previous && previous.channels.length > 0) {
    const cache = {
      channels: previous.channels,
      loadedAt: now,
    };
    return {
      cache,
      channels: previous.channels,
      errors,
      usedStaleCache: true,
    };
  }

  return {
    cache: null,
    channels,
    errors,
    usedStaleCache: false,
  };
}
