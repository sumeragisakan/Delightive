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

export class ReasoningProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ReasoningProviderError";
  }
}
