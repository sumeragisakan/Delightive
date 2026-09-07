import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createDatabase } from "./connection";

const connection = createDatabase();

try {
  migrate(connection.db, {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  console.log(`Database migrated: ${connection.databasePath}`);
} finally {
  connection.sqlite.close();
}
