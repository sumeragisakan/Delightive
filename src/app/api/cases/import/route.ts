import { revalidatePath } from "next/cache";

import { databaseConnection } from "@/db/client";
import { SearchService } from "@/db/services/search-service";
import {
  CaseBundleError,
  importCaseBundle,
  MAX_CASE_BUNDLE_BYTES,
  parseCaseBundleText,
  previewCaseBundle,
} from "@/portability/case-bundle";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw new CaseBundleError("请上传 JSON 格式的 Delightive 案件包。");
    }

    const mode = new URL(request.url).searchParams.get("mode") ?? "preview";
    if (mode !== "preview" && mode !== "import") {
      throw new CaseBundleError("未知的导入操作。");
    }

    const source = await readLimitedBody(request);
    const bundle = parseCaseBundleText(databaseConnection, source);

    if (mode === "preview") {
      return Response.json({
        ok: true,
        preview: previewCaseBundle(databaseConnection, bundle),
      });
    }

    const title = new URL(request.url).searchParams.get("title") ?? undefined;
    const result = importCaseBundle(databaseConnection, bundle, title);
    try {
      new SearchService(databaseConnection).rebuildCase(result.caseId);
    } catch (error) {
      console.error("Imported case search indexing failed:", error);
    }
    revalidatePath("/");
    revalidatePath("/search");
    revalidatePath(result.url);
    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof CaseBundleError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("Case import failed:", error);
    return Response.json({ error: "案件导入失败。" }, { status: 500 });
  }
}

async function readLimitedBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CASE_BUNDLE_BYTES) {
    throw new CaseBundleError("案件包超过 10 MB 限制。");
  }
  if (!request.body) {
    throw new CaseBundleError("没有收到案件包内容。");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_CASE_BUNDLE_BYTES) {
      await reader.cancel();
      throw new CaseBundleError("案件包超过 10 MB 限制。");
    }
    chunks.push(value);
  }
  if (received === 0) {
    throw new CaseBundleError("案件包内容为空。");
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CaseBundleError("案件包不是有效的 UTF-8 文本。");
  }
}
