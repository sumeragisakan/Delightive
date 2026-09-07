"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createCaseFromToolAction } from "../actions";

type CaseToolInput = {
  description?: string;
  timelineMode?: "relative" | "calendar" | "ordinal";
  title: string;
};

type WebMcpContext = {
  registerTool: (
    tool: {
      annotations?: {
        readOnlyHint?: boolean;
        untrustedContentHint?: boolean;
      };
      description: string;
      execute: (input: unknown) => unknown | Promise<unknown>;
      inputSchema: object;
      name: string;
      title?: string;
    },
    options?: { signal?: AbortSignal },
  ) => Promise<void> | void;
};

export function CaseWebMcpTools() {
  const router = useRouter();

  useEffect(() => {
    const modelContext = (
      document as Document & { readonly modelContext?: WebMcpContext }
    ).modelContext;

    if (!modelContext?.registerTool) {
      return;
    }

    const lifecycle = new AbortController();

    void Promise.resolve(
      modelContext.registerTool(
        {
          annotations: {
            readOnlyHint: false,
            untrustedContentHint: false,
          },
          description:
            "Create a new local Delightive case file, then open its people workspace.",
          execute: async (input) => {
            const result = await createCaseFromToolAction(
              normalizeCaseToolInput(input),
            );

            if (!result.ok) {
              throw new Error(result.message);
            }

            router.push(result.url);
            router.refresh();
            return { id: result.id, title: result.title, url: result.url };
          },
          inputSchema: {
            additionalProperties: false,
            properties: {
              description: { maxLength: 2_000, type: "string" },
              timelineMode: {
                default: "relative",
                enum: ["relative", "calendar", "ordinal"],
                type: "string",
              },
              title: { maxLength: 120, minLength: 1, type: "string" },
            },
            required: ["title"],
            type: "object",
          },
          name: "create_case",
          title: "Create case file",
        },
        { signal: lifecycle.signal },
      ),
    ).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      console.warn("Unable to register Delightive WebMCP tools.", error);
    });

    return () => lifecycle.abort();
  }, [router]);

  return null;
}

function normalizeCaseToolInput(input: unknown): CaseToolInput {
  if (!input || typeof input !== "object") {
    throw new Error("Case input must be an object.");
  }

  const value = input as Record<string, unknown>;

  return {
    description:
      typeof value.description === "string" ? value.description : "",
    timelineMode:
      value.timelineMode === "calendar" || value.timelineMode === "ordinal"
        ? value.timelineMode
        : "relative",
    title: typeof value.title === "string" ? value.title : "",
  };
}
