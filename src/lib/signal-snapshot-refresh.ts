import {
  DEFAULT_SIGNAL_FEED_RANGE,
  type SignalFeedRange,
} from "./signal-feed-range.ts";

export function shouldRefreshSignalSnapshotsOnEffect(
  previousRange: SignalFeedRange | null,
  currentRange: SignalFeedRange,
) {
  if (previousRange === null) {
    return currentRange !== DEFAULT_SIGNAL_FEED_RANGE;
  }
  return previousRange !== currentRange;
}
