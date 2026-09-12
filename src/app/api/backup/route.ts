import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { databaseConnection } from "@/db/client";

export const runtime = "nodejs";

export async function GET() {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "delightive-backup-"),
  );
  const backupPath = path.join(temporaryDirectory, "delightive.sqlite");

  try {
    await databaseConnection.sqlite.backup(backupPath);
    const backup = await readFile(backupPath);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(backup), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="delightive-backup-${date}.sqlite"`,
        "Content-Type": "application/vnd.sqlite3",
      },
    });
  } catch (error) {
    console.error("Database backup failed:", error);
    return Response.json({ error: "数据库备份失败。" }, { status: 500 });
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true }).catch(
      (cleanupError) => console.error("Backup cleanup failed:", cleanupError),
    );
  }
}
