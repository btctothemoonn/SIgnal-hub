export type TelegramButtonLink = {
  text: string;
  url: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function extractTelegramButtonLinks(value: unknown): TelegramButtonLink[] {
  const result: TelegramButtonLink[] = [];

  const visit = (input: unknown) => {
    if (!input) return;
    if (Array.isArray(input)) {
      for (const item of input) visit(item);
      return;
    }
    if (!isRecord(input)) return;

    const url = stringValue(input.url);
    if (url) {
      result.push({
        text: stringValue(input.text),
        url,
      });
    }

    for (const nested of Object.values(input)) {
      if (nested !== input.url && nested !== input.text) {
        visit(nested);
      }
    }
  };

  visit(value);
  return result;
}
