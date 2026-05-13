export type ChartLabelTarget = {
  id: string;
  y: number;
};

export type ChartLabelLayoutOptions = {
  minY: number;
  maxY: number;
  minGap: number;
};

export function packChartLabelPositions(
  targets: ChartLabelTarget[],
  options: ChartLabelLayoutOptions,
): Record<string, number> {
  const sorted = targets
    .filter((target) => target.id && Number.isFinite(target.y))
    .map((target) => ({
      id: target.id,
      y: Math.min(options.maxY, Math.max(options.minY, target.y)),
    }))
    .sort((left, right) => left.y - right.y);

  if (sorted.length === 0) return {};

  const available = Math.max(0, options.maxY - options.minY);
  const gap =
    sorted.length > 1
      ? Math.min(options.minGap, available / (sorted.length - 1))
      : 0;
  const positioned = sorted.map((target) => ({ ...target }));

  for (let index = 1; index < positioned.length; index += 1) {
    positioned[index].y = Math.max(
      positioned[index].y,
      positioned[index - 1].y + gap,
    );
  }

  const lastIndex = positioned.length - 1;
  if (positioned[lastIndex].y > options.maxY) {
    positioned[lastIndex].y = options.maxY;
    for (let index = lastIndex - 1; index >= 0; index -= 1) {
      positioned[index].y = Math.min(
        positioned[index].y,
        positioned[index + 1].y - gap,
      );
    }
  }

  if (positioned[0].y < options.minY) {
    const offset = options.minY - positioned[0].y;
    for (const item of positioned) {
      item.y += offset;
    }
  }

  return Object.fromEntries(
    positioned.map((target) => [
      target.id,
      Math.min(options.maxY, Math.max(options.minY, target.y)),
    ]),
  );
}
