import { z } from "zod";

import {
  claimRelationKinds,
  reasoningSuggestionKinds,
} from "../db/schema";

export const reasoningCitationSchema = z
  .object({
    claimId: z.string().min(1),
    relation: z.enum(claimRelationKinds),
    revision: z.number().int().min(1),
  })
  .strict();

export const reasoningSuggestionOutputSchema = z
  .object({
    citations: z.array(reasoningCitationSchema).min(1).max(12),
    confidence: z.number().int().min(0).max(100),
    content: z.string().trim().min(1).max(8_000),
    kind: z.enum(reasoningSuggestionKinds),
    rationale: z.string().trim().min(1).max(4_000),
    secondaryClaimId: z.string().min(1).nullable(),
    targetClaimId: z.string().min(1).nullable(),
    title: z.string().trim().min(1).max(160),
  })
  .strict();

export const reasoningOutputSchema = z
  .object({
    suggestions: z.array(reasoningSuggestionOutputSchema).max(8),
    summary: z.string().trim().min(1).max(2_000),
  })
  .strict();

export type ReasoningCitation = z.infer<typeof reasoningCitationSchema>;
export type ReasoningSuggestionOutput = z.infer<
  typeof reasoningSuggestionOutputSchema
>;
export type ReasoningOutput = z.infer<typeof reasoningOutputSchema>;

export const reasoningOutputJsonSchema = {
  additionalProperties: false,
  properties: {
    suggestions: {
      items: {
        additionalProperties: false,
        properties: {
          citations: {
            items: {
              additionalProperties: false,
              properties: {
                claimId: { type: "string" },
                relation: { enum: claimRelationKinds, type: "string" },
                revision: { minimum: 1, type: "integer" },
              },
              required: ["claimId", "relation", "revision"],
              type: "object",
            },
            maxItems: 12,
            minItems: 1,
            type: "array",
          },
          confidence: { maximum: 100, minimum: 0, type: "integer" },
          content: { maxLength: 8_000, minLength: 1, type: "string" },
          kind: { enum: reasoningSuggestionKinds, type: "string" },
          rationale: { maxLength: 4_000, minLength: 1, type: "string" },
          secondaryClaimId: { type: ["string", "null"] },
          targetClaimId: { type: ["string", "null"] },
          title: { maxLength: 160, minLength: 1, type: "string" },
        },
        required: [
          "citations",
          "confidence",
          "content",
          "kind",
          "rationale",
          "secondaryClaimId",
          "targetClaimId",
          "title",
        ],
        type: "object",
      },
      maxItems: 8,
      type: "array",
    },
    summary: { maxLength: 2_000, minLength: 1, type: "string" },
  },
  required: ["suggestions", "summary"],
  type: "object",
} as const;
