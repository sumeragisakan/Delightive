import type { AiConnectionDiagnostic } from "@/db/services/ai-settings-service";

export type ActionState = {
  fieldErrors?: Record<string, string[] | undefined>;
  message: string;
  status: "idle" | "error" | "success";
};

export type AiDiagnosticActionState = ActionState & {
  diagnostic?: AiConnectionDiagnostic;
};

export const initialActionState: ActionState = {
  message: "",
  status: "idle",
};

export const initialAiDiagnosticState: AiDiagnosticActionState = {
  message: "",
  status: "idle",
};
