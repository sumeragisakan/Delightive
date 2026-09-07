import "server-only";

import { createDatabase, type DatabaseConnection } from "./connection";

const databaseGlobal = globalThis as typeof globalThis & {
  delightiveDatabase?: DatabaseConnection;
};

export const databaseConnection =
  databaseGlobal.delightiveDatabase ?? createDatabase();

if (process.env.NODE_ENV !== "production") {
  databaseGlobal.delightiveDatabase = databaseConnection;
}

export const db = databaseConnection.db;
export const sqlite = databaseConnection.sqlite;
