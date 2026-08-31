export function primaryMobileNavItems<T extends { key: string }>(
  items: readonly T[],
) {
  return items.filter((item) => item.key !== "settings");
}
