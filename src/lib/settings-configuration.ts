import { isAdminAuthConfigured } from "./admin-auth";
import { getAlphaSummaryProviderCandidates } from "./alpha-summary";

type SettingsEnvironment = Record<string, string | undefined>;

export type SettingsConfigurationStatus = {
  summaryConfigured: boolean;
  translationConfigured: boolean;
  adminAccessConfigured: boolean;
};

function hasTranslationCredentials(env: SettingsEnvironment): boolean {
  if (env.AI_TRANSLATION_API_KEY?.trim() || env.MINIMAX_API_KEY?.trim()) {
    return true;
  }

  return (
    env.AI_TRANSLATION_ALLOW_SUMMARY_KEY?.trim().toLowerCase() === "true" &&
    Boolean(env.AI_SUMMARY_API_KEY?.trim() || env.OPENAI_API_KEY?.trim())
  );
}

export function getSettingsConfigurationStatus(
  env: SettingsEnvironment = process.env,
): SettingsConfigurationStatus {
  return {
    summaryConfigured: getAlphaSummaryProviderCandidates(env).length > 0,
    translationConfigured: hasTranslationCredentials(env),
    adminAccessConfigured: isAdminAuthConfigured(env),
  };
}
