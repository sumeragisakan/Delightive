import { eq } from "drizzle-orm";

import type { AiRuntimePreferences } from "../../ai/config";
import type { DatabaseConnection } from "../connection";
import { aiRuntimeSettings } from "../schema";

const singletonId = "default";

export class AiSettingsRepository {
  constructor(private readonly connection: DatabaseConnection) {}

  get() {
    return this.connection.db
      .select()
      .from(aiRuntimeSettings)
      .where(eq(aiRuntimeSettings.id, singletonId))
      .get();
  }

  save(preferences: AiRuntimePreferences) {
    const now = new Date();
    return this.connection.db
      .insert(aiRuntimeSettings)
      .values({
        ...preferences,
        createdAt: now,
        id: singletonId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        set: { ...preferences, updatedAt: now },
        target: aiRuntimeSettings.id,
      })
      .returning()
      .get();
  }
}
