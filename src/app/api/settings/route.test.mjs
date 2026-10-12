import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(
        pathToFileURL(resolve(process.cwd(), "src", `${specifier.slice(2)}.ts`)).href,
        context,
      );
    }

    if (specifier.startsWith(".") && !extname(specifier)) {
      const base = dirname(fileURLToPath(context.parentURL));
      for (const extension of [".ts", ".tsx", ".js"]) {
        const candidate = resolve(base, `${specifier}${extension}`);
        if (existsSync(candidate)) {
          return nextResolve(pathToFileURL(candidate).href, context);
        }
      }
    }

    return nextResolve(specifier, context);
  },
});

const { getSettingsConfigurationStatus } = await import(
  "../../../lib/settings-configuration.ts"
);

const routeUrl = new URL("./route.ts", import.meta.url);
const statusUrl = new URL("../../../lib/settings-configuration.ts", import.meta.url);
const route = readFileSync(routeUrl, "utf8");
const statusSource = existsSync(statusUrl) ? readFileSync(statusUrl, "utf8") : "";

const getBlock = route.match(
  /export async function GET\(\) \{([\s\S]*?)\n\}\n\nconst WATCH_PLAN_GATE/,
)?.[1];

assert.ok(getBlock, "settings GET handler must remain independently inspectable");
assert.match(getBlock, /configuration: getSettingsConfigurationStatus\(\)/);
assert.doesNotMatch(
  getBlock,
  /API_KEY|BASE_URL|PASSWORD|SECRET|TOKEN/,
  "settings GET must not serialize secret-bearing environment values",
);

assert.match(
  statusSource,
  /summaryConfigured: getAlphaSummaryProviderCandidates\(env\)\.length > 0/,
);
assert.match(
  statusSource,
  /translationConfigured: hasTranslationCredentials\(env\)/,
);
assert.match(
  statusSource,
  /adminAccessConfigured: isAdminAuthConfigured\(env\)/,
);

const returnBlock = statusSource.match(/return \{([\s\S]*?)\n  \};/)?.[1] ?? "";
const returnedFields = [
  ...returnBlock.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gm),
].map((match) => match[1]);

assert.deepEqual(returnedFields, [
  "summaryConfigured",
  "translationConfigured",
  "adminAccessConfigured",
]);
assert.doesNotMatch(
  returnBlock,
  /\b(?:apiKey|baseUrl|password|secret|token)\s*:/i,
  "configuration status must contain booleans only, never secret values or fragments",
);

assert.equal(
  getSettingsConfigurationStatus({ DEEPSEEK_API_KEY: "test-deepseek-key" }).translationConfigured,
  true,
  "official DeepSeek credentials enable translation",
);
assert.equal(
  getSettingsConfigurationStatus({ MINIMAX_API_KEY: "test-minimax-key" }).translationConfigured,
  false,
  "legacy MiniMax credentials cannot enable DeepSeek translation",
);

const suppliedSecrets = {
  DEEPSEEK_API_KEY: "test-deepseek-secret-value",
  AI_SUMMARY_API_KEY: "summary-secret-value",
  AI_SUMMARY_BASE_URL: "https://summary.internal.example/v1",
  AI_SUMMARY_MODEL: "summary-model-value",
  AI_TRANSLATION_API_KEY: "translation-secret-value",
  AI_TRANSLATION_BASE_URL: "https://translation.internal.example/v1",
  AI_TRANSLATION_MODEL: "translation-model-value",
  ADMIN_PASSWORD: "admin-password-value",
  ADMIN_SESSION_SECRET: "admin-session-secret-value",
};
const configured = getSettingsConfigurationStatus(suppliedSecrets);

assert.deepEqual(configured, {
  summaryConfigured: true,
  translationConfigured: true,
  adminAccessConfigured: true,
});
assert.ok(
  Object.values(configured).every((value) => typeof value === "boolean"),
  "the GET configuration payload must be boolean-only",
);

const serializedConfiguration = JSON.stringify(configured);
for (const suppliedValue of Object.values(suppliedSecrets)) {
  assert.doesNotMatch(
    serializedConfiguration,
    new RegExp(suppliedValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "the GET configuration payload must not include supplied secret values",
  );
}

assert.equal(
  getSettingsConfigurationStatus({
    AI_SUMMARY_API_KEY: "summary-secret",
    AI_SUMMARY_BASE_URL: "https://api.deepseek.com",
    ADMIN_PASSWORD: "admin-password",
    ADMIN_SESSION_SECRET: "admin-session-secret",
  }).translationConfigured,
  true,
  "an explicitly paired DeepSeek summary credential also enables translation",
);

assert.equal(
  getSettingsConfigurationStatus({
    AI_SUMMARY_API_KEY: "test-openai-key",
    AI_SUMMARY_BASE_URL: "https://api.openai.com/v1",
    AI_TRANSLATION_ALLOW_SUMMARY_KEY: "true",
  }).translationConfigured,
  false,
  "legacy opt-in does not forward other providers' keys to DeepSeek",
);
assert.equal(
  getSettingsConfigurationStatus({
    AI_TRANSLATION_API_KEY: "test-deepseek-translation-key",
    AI_TRANSLATION_BASE_URL: "https://api.deepseek.com/v1",
  }).translationConfigured,
  true,
  "translation-specific DeepSeek configuration is recognized",
);

console.log("ok - settings GET exposes boolean configuration status only");
