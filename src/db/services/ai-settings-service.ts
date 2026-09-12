import {
  createConfiguredAiProvider,
  getAiConfigurationStatus,
  getEnvironmentAiPreferences,
  type AiConfigurationStatus,
  type AiRuntimePreferences,
} from "../../ai/config";
import {
  AiConnectionDiagnosticError,
  type AiConnectionDiagnosticCode,
} from "../../ai/provider";
import type { DatabaseConnection } from "../connection";
import { AiSettingsRepository } from "../repositories/ai-settings-repository";

export type AiSettingsView = AiConfigurationStatus & {
  source: "environment" | "saved";
};

export type AiConnectionDiagnostic = {
  checkedAt: string;
  code: AiConnectionDiagnosticCode | "connected";
  durationMs: number | null;
  message: string;
  model: string;
  ok: boolean;
  provider: "openai";
  traceId: string | null;
};

export class AiSettingsService {
  private readonly repository: AiSettingsRepository;

  constructor(private readonly connection: DatabaseConnection) {
    this.repository = new AiSettingsRepository(connection);
  }

  getPreferences(): AiRuntimePreferences {
    const saved = this.repository.get();
    return saved
      ? {
          enabled: saved.enabled,
          maxOutputTokens: saved.maxOutputTokens,
          model: saved.model,
          provider: saved.provider,
          timeoutMs: saved.timeoutMs,
        }
      : getEnvironmentAiPreferences();
  }

  getSettings(): AiSettingsView {
    const saved = this.repository.get();
    const preferences = saved
      ? {
          enabled: saved.enabled,
          maxOutputTokens: saved.maxOutputTokens,
          model: saved.model,
          provider: saved.provider,
          timeoutMs: saved.timeoutMs,
        }
      : getEnvironmentAiPreferences();
    return {
      ...getAiConfigurationStatus(preferences),
      source: saved ? "saved" : "environment",
    };
  }

  save(preferences: AiRuntimePreferences) {
    return this.repository.save(preferences);
  }

  createProvider() {
    return createConfiguredAiProvider(this.getPreferences());
  }

  async diagnose(): Promise<AiConnectionDiagnostic> {
    const settings = this.getSettings();
    const base = {
      checkedAt: new Date().toISOString(),
      model: settings.model,
      provider: settings.provider,
    } as const;

    if (!settings.enabled) {
      return {
        ...base,
        code: "disabled",
        durationMs: null,
        message: "AI 推演当前已停用；启用并保存设置后再测试。",
        ok: false,
        traceId: null,
      };
    }
    if (!settings.apiKeyConfigured) {
      return {
        ...base,
        code: "not_configured",
        durationMs: null,
        message: "尚未配置 OPENAI_API_KEY，未发送网络请求。",
        ok: false,
        traceId: null,
      };
    }

    const startedAt = Date.now();
    try {
      const result = await this.createProvider().diagnoseConnection();
      return {
        ...base,
        code: "connected",
        durationMs: result.durationMs,
        message: "连接、身份验证、模型访问与 Responses API 均正常。",
        ok: true,
        traceId: result.requestId ?? result.clientRequestId,
      };
    } catch (error) {
      if (error instanceof AiConnectionDiagnosticError) {
        return {
          ...base,
          code: error.code,
          durationMs: Date.now() - startedAt,
          message: error.message,
          ok: false,
          traceId: null,
        };
      }
      return {
        ...base,
        code: "provider",
        durationMs: Date.now() - startedAt,
        message: "连接测试失败，请检查本地配置后重试。",
        ok: false,
        traceId: null,
      };
    }
  }
}
