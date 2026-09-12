import { createHash } from "node:crypto";

import type { ReasoningContext } from "../db/services/reasoning-context-service";

export function serializeReasoningContext(context: ReasoningContext) {
  return JSON.stringify(sortJsonValue(context));
}

export function fingerprintReasoningContext(contextJson: string) {
  return createHash("sha256").update(contextJson).digest("hex");
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJsonValue(child)]),
    );
  }
  return value;
}
