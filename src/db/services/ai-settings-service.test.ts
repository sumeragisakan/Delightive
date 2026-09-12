import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDatabase, type DatabaseConnection } from "../connection";
import { AiSettingsService } from "./ai-settings-service";

describe("AI settings and connection diagnostics", () => {
  let connection: DatabaseConnection;
  const originalEnvironment = {
    AI_MAX_OUTPUT_TOKENS: process.env.AI_MAX_OUTPUT_TOKENS,
    AI_REQUEST_TIMEOUT_MS: process.env.AI_REQUEST_TIMEOUT_MS,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
  };

  beforeEach(() => {
    connection = createDatabase(":memory:");
    migrate(connection.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_MODEL = "environment-model";
    process.env.AI_REQUEST_TIMEOUT_MS = "45000";
    process.env.AI_MAX_OUTPUT_TOKENS = "1800";
    process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
  });

  afterEach(() => {
    connection.sqlite.close();
    vi.unstubAllGlobals();
    restoreEnvironment(originalEnvironment);
  });

  it("uses environment defaults until non-secret preferences are saved", () => {
    const service = new AiSettingsService(connection);
    expect(service.getSettings()).toMatchObject({
      apiKeyConfigured: false,
      configured: false,
      maxOutputTokens: 1800,
      model: "environment-model",
      source: "environment",
      timeoutMs: 45000,
    });

    service.save({
      enabled: false,
      maxOutputTokens: 3200,
      model: "saved-model",
      provider: "openai",
      timeoutMs: 90000,
    });

    expect(service.getSettings()).toMatchObject({
      configured: false,
      enabled: false,
      maxOutputTokens: 3200,
      model: "saved-model",
      source: "saved",
      timeoutMs: 90000,
    });
    const columns = connection.sqlite
      .prepare("pragma table_info(ai_runtime_settings)")
      .all() as Array<{ name: string }>;
    expect(columns.map(({ name }) => name)).not.toContain("api_key");
    expect(
      JSON.stringify(
        connection.sqlite.prepare("select * from ai_runtime_settings").get(),
      ),
    ).not.toContain("OPENAI_API_KEY");
  });

  it("returns a local diagnosis without making a request when the key is absent", async () => {
    const fetchImplementation = vi.fn();
    vi.stubGlobal("fetch", fetchImplementation);

    const result = await new AiSettingsService(connection).diagnose();

    expect(result).toMatchObject({
      code: "not_configured",
      durationMs: null,
      ok: false,
      traceId: null,
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("reports a successful Responses API diagnostic with a safe trace ID", async () => {
    process.env.OPENAI_API_KEY = "test-key-never-persisted";
    const fetchImplementation = vi.fn(async () =>
      new Response(JSON.stringify({ id: "resp_diagnostic" }), {
        headers: { "x-request-id": "req_trace_456" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchImplementation);
    const service = new AiSettingsService(connection);

    const result = await service.diagnose();

    expect(result).toMatchObject({
      code: "connected",
      model: "environment-model",
      ok: true,
      traceId: "req_trace_456",
    });
    expect(JSON.stringify(result)).not.toContain("test-key-never-persisted");
  });
});

function restoreEnvironment(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
