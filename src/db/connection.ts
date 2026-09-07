import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

export const defaultDatabasePath = ".data/delightive.sqlite";

export function resolveDatabasePath(configuredPath = process.env.DATABASE_PATH) {
  const databasePath = configuredPath?.trim() || defaultDatabasePath;

  if (databasePath === ":memory:") {
    return databasePath;
  }

  return path.isAbsolute(databasePath)
    ? databasePath
    : path.resolve(process.cwd(), databasePath);
}

export function createDatabase(configuredPath?: string) {
  const databasePath = resolveDatabasePath(configuredPath);

  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");

  if (databasePath !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }

  return {
    databasePath,
    db: drizzle(sqlite, { schema }),
    sqlite,
  };
}

export type DatabaseConnection = ReturnType<typeof createDatabase>;
export type AppDatabase = DatabaseConnection["db"];
