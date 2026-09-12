import { describe, expect, it, vi } from "vitest";

import { OpenAiResponsesProvider } from "./openai-responses-provider";

describe("OpenAI Responses provider", () => {
  it("uses server authentication, structured output, and disables remote storage", async () => {
    const fetchImplementation = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "resp_123",
          output: [
            {
              content: [
                {
                  text: JSON.stringify({
                    suggestions: [
                      {
                        citations: [
                          { claimId: "claim-1", relation: "supports", revision: 1 },
                        ],
                        confidence: 80,
                        content: "存在第二条通路。",
                        kind: "hypothesis",
                        rationale: "门锁事实没有排除其他出口。",
                        secondaryClaimId: null,
                        targetClaimId: null,
                        title: "第二通路",
                      },
                    ],
                    summary: "提出一条待验证假设。",
                  }),
                  type: "output_text",
                },
              ],
              type: "message",
            },
          ],
          usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const provider = new OpenAiResponsesProvider({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1/",
      fetchImplementation,
      model: "test-model",
      timeoutMs: 10_000,
    });

    const result = await provider.generate({
      context: {
        acceptedInferences: [],
        case: {
          id: "case-1",
          timelineMode: "relative",
          timelineOriginAt: null,
          timelineOriginLabel: null,
          title: "测试案件",
        },
        excluded: {
          draft: 0,
          ineligibleAccepted: 0,
          needsReview: 0,
          reasoningNeedsReview: 0,
          rejected: 0,
          rejectedReasoning: 0,
          staleAcceptedInferences: 0,
          superseded: 0,
          unresolvedConflicts: 0,
        },
        exploration: { branch: null, claims: [] },
        fixedEvidence: [],
        sources: [],
      },
      focusClaimId: null,
      mode: "hypothesis_expansion",
      userPrompt: "",
    });

    const [url, request] = (fetchImplementation as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(String((request as RequestInit).body));
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect((request as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-key",
    });
    expect(body).toMatchObject({
      model: "test-model",
      store: false,
      text: { format: { strict: true, type: "json_schema" } },
    });
    expect(result).toMatchObject({
      remoteResponseId: "resp_123",
      summary: "提出一条待验证假设。",
      usage: { totalTokens: 30 },
    });
  });

  it("classifies rate limits without persisting an upstream response body", async () => {
    const provider = new OpenAiResponsesProvider({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      fetchImplementation: (async () =>
        new Response("sensitive upstream body", { status: 429 })) as typeof fetch,
      model: "test-model",
      timeoutMs: 10_000,
    });

    await expect(
      provider.generate({
        context: {
          acceptedInferences: [],
          case: {
            id: "case-1",
            timelineMode: "relative",
            timelineOriginAt: null,
            timelineOriginLabel: null,
            title: "测试案件",
          },
          excluded: {
            draft: 0,
            ineligibleAccepted: 0,
            needsReview: 0,
            reasoningNeedsReview: 0,
            rejected: 0,
            rejectedReasoning: 0,
            staleAcceptedInferences: 0,
            superseded: 0,
            unresolvedConflicts: 0,
          },
          exploration: { branch: null, claims: [] },
          fixedEvidence: [],
          sources: [],
        },
        focusClaimId: null,
        mode: "consistency_check",
        userPrompt: "",
      }),
    ).rejects.toMatchObject({ code: "rate_limit" });
  });
});
