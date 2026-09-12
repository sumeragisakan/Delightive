import { databaseConnection } from "@/db/client";
import {
  buildCaseBundleFilename,
  CaseBundleError,
  exportCaseBundle,
  serializeCaseBundle,
} from "@/portability/case-bundle";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  try {
    const { caseId } = await params;
    const bundle = exportCaseBundle(databaseConnection, caseId);
    const filename = buildCaseBundleFilename(
      bundle.tables.cases[0].title as string,
    );

    return new Response(serializeCaseBundle(bundle), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": contentDisposition(filename),
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    if (error instanceof CaseBundleError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    console.error("Case export failed:", error);
    return Response.json({ error: "案件导出失败。" }, { status: 500 });
  }
}

function contentDisposition(filename: string) {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "-");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
