import type { ReasoningContext } from "../db/services/reasoning-context-service";
import type { ReasoningRunMode } from "../db/schema";

import type { ReasoningOutput } from "./reasoning-output";

export type ReasoningModelRequest = {
  context: ReasoningContext;
  focusClaimId: string | null;
  mode: ReasoningRunMode;
  userPrompt: string;
};

export type ReasoningModelResult = ReasoningOutput & {
  remoteResponseId: string | null;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
};

export interface ReasoningModelProvider {
  readonly model: string;
  readonly name: string;
  generate(request: ReasoningModelRequest): Promise<ReasoningModelResult>;
}

export type AiConnectionDiagnosticCode =
  | "authentication"
  | "disabled"
  | "model"
  | "network"
  | "not_configured"
  | "provider"
  | "rate_limit"
  | "timeout";

export class AiConnectionDiagnosticError extends Error {
  readonly code: Exclude<
    AiConnectionDiagnosticCode,
    "disabled" | "not_configured"
  >;

  constructor(
    code: Exclude<AiConnectionDiagnosticCode, "disabled" | "not_configured">,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.code = code;
    this.name = "AiConnectionDiagnosticError";
  }
}

export type ReasoningProviderErrorCode =
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "network"
  | "invalid_output"
  | "provider";

export class ReasoningProviderError extends Error {
  readonly code: ReasoningProviderErrorCode;

  constructor(
    code: ReasoningProviderErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.code = code;
    this.name = "ReasoningProviderError";
  }
}
