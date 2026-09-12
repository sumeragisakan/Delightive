import { OpenAiResponsesProvider } from "./openai-responses-provider";
import { ReasoningProviderError } from "./provider";

export const defaultAiModel = "gpt-5.2";
export const defaultAiTimeoutMs = 60_000;
export const defaultAiMaxOutputTokens = 2_500;
const defaultBaseUrl = "https://api.openai.com/v1";

export type AiRuntimePreferences = {
  enabled: boolean;
  maxOutputTokens: number;
  model: string;
  provider: "openai";
  timeoutMs: number;
};

export type AiConfigurationStatus = AiRuntimePreferences & {
  apiKeyConfigured: boolean;
  configured: boolean;
  endpointHost: string;
};

export function getEnvironmentAiPreferences(): AiRuntimePreferences {
  return {
    enabled: true,
    maxOutputTokens: readBoundedInteger(
      process.env.AI_MAX_OUTPUT_TOKENS,
      defaultAiMaxOutputTokens,
      256,
      10_000,
    ),
    model: process.env.OPENAI_MODEL?.trim() || defaultAiModel,
    provider: "openai",
    timeoutMs: readBoundedInteger(
      process.env.AI_REQUEST_TIMEOUT_MS,
      defaultAiTimeoutMs,
      5_000,
      180_000,
    ),
  };
}

export function getAiConfigurationStatus(
  preferences = getEnvironmentAiPreferences(),
): AiConfigurationStatus {
  const apiKeyConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
  return {
    ...preferences,
    apiKeyConfigured,
    configured: preferences.enabled && apiKeyConfigured,
    endpointHost: readEndpointHost(
      process.env.OPENAI_BASE_URL?.trim() || defaultBaseUrl,
    ),
  };
}

export function createConfiguredAiProvider(
  preferences = getEnvironmentAiPreferences(),
) {
  if (!preferences.enabled) {
    throw new ReasoningProviderError(
      "provider",
      "AI 推演已在本地设置中停用。",
    );
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new ReasoningProviderError(
      "authentication",
      "尚未配置 OPENAI_API_KEY。请在项目根目录的 .env.local 中添加密钥并重启开发服务器。",
    );
  }

  return new OpenAiResponsesProvider({
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL?.trim() || defaultBaseUrl,
    maxOutputTokens: preferences.maxOutputTokens,
    model: preferences.model,
    timeoutMs: preferences.timeoutMs,
  });
}

function readBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function readEndpointHost(baseUrl: string) {
  try {
    return new URL(baseUrl).host || "无效地址";
  } catch {
    return "无效地址";
  }
}
