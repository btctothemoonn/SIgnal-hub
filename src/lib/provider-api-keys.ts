type EnvLike = Record<string, string | undefined>;

export function getProviderApiKeys(env: EnvLike, names: string[]) {
  const keys: string[] = [];
  for (const name of names) {
    const raw = env[name];
    if (!raw) continue;
    for (const value of raw.split(/[,;\s]+/)) {
      const key = value.trim();
      if (key && !keys.includes(key)) {
        keys.push(key);
      }
    }
  }
  return keys;
}

export function pickProviderApiKey(keys: string[], index: number) {
  if (keys.length === 0) return "";
  const normalizedIndex = Math.abs(Math.trunc(index)) % keys.length;
  return keys[normalizedIndex] ?? "";
}
