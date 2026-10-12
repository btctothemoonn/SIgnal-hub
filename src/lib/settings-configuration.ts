import { isAdminAuthConfigured } from "./admin-auth";
import { getAlphaSummaryProviderCandidates } from "./alpha-summary";
import { getDeepSeekProviderCandidates } from "./deepseek-provider";

type SettingsEnvironment = Record<string, string | undefined>;

export type SettingsConfigurationStatus = {
  summaryConfigured: boolean;
  translationConfigured: boolean;
  adminAccessConfigured: boolean;
};

function hasTranslationCredentials(env: SettingsEnvironment): boolean {
  return getDeepSeekProviderCandidates(env).length > 0;
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
