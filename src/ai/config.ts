import { OpenAiResponsesProvider } from "./openai-responses-provider";
import { ReasoningProviderError } from "./provider";

const defaultModel = "gpt-5.2";
const defaultBaseUrl = "https://api.openai.com/v1";

export type AiConfigurationStatus = {
  configured: boolean;
  model: string;
  provider: "openai";
};

export function getAiConfigurationStatus(): AiConfigurationStatus {
  return {
    configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    model: process.env.OPENAI_MODEL?.trim() || defaultModel,
    provider: "openai",
  };
}

export function createConfiguredAiProvider() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new ReasoningProviderError(
      "尚未配置 OPENAI_API_KEY。请在项目根目录的 .env.local 中添加密钥并重启开发服务器。",
    );
  }

  const timeoutValue = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? "60000");
  const timeoutMs =
    Number.isFinite(timeoutValue) && timeoutValue >= 5_000
      ? Math.min(timeoutValue, 180_000)
      : 60_000;

  return new OpenAiResponsesProvider({
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL?.trim() || defaultBaseUrl,
    model: process.env.OPENAI_MODEL?.trim() || defaultModel,
    timeoutMs,
  });
}
