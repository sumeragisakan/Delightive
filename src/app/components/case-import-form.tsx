"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { CaseBundlePreview } from "@/portability/case-bundle";

const maxCaseBundleBytes = 10 * 1024 * 1024;

type ImportResponse =
  | { error: string }
  | { caseId: string; ok: true; title: string; url: string };

export function CaseImportForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CaseBundlePreview | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"preview" | "import" | null>(null);

  async function requestPreview() {
    if (!file) {
      setError("请先选择案件包文件。");
      return;
    }
    if (file.size > maxCaseBundleBytes) {
      setError("案件包超过 10 MB 限制。");
      return;
    }

    setPending("preview");
    setError("");
    setPreview(null);
    try {
      const response = await fetch("/api/cases/import?mode=preview", {
        body: file,
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as
        | { error: string }
        | { ok: true; preview: CaseBundlePreview };
      if (!response.ok || !("preview" in payload)) {
        throw new Error("error" in payload ? payload.error : "案件包预检失败。");
      }
      setPreview(payload.preview);
      setTitle(payload.preview.originalTitle);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "案件包预检失败。");
    } finally {
      setPending(null);
    }
  }

  async function confirmImport() {
    if (!file || !preview) return;
    setPending("import");
    setError("");
    try {
      const parameters = new URLSearchParams({ mode: "import", title });
      const response = await fetch(`/api/cases/import?${parameters}`, {
        body: file,
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as ImportResponse;
      if (!response.ok || !("url" in payload)) {
        throw new Error("error" in payload ? payload.error : "案件导入失败。");
      }
      router.push(payload.url);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "案件导入失败。");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-2 block text-sm font-semibold" htmlFor="case-bundle-file">
          案件包文件
        </label>
        <input
          accept=".json,application/json"
          className="block w-full rounded-xl border border-[var(--line)] bg-white/80 px-3 py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--ink)] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
          id="case-bundle-file"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setPreview(null);
            setError("");
          }}
          type="file"
        />
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
          支持 .delightive.json，最大 10 MB。文件会先预检，不会立即写入。
        </p>
      </div>

      {!preview ? (
        <button
          className="secondary-button w-full justify-center"
          disabled={pending !== null}
          onClick={requestPreview}
          type="button"
        >
          {pending === "preview" ? "正在预检…" : "预检案件包"}
        </button>
      ) : (
        <div className="rounded-xl border border-[var(--line)] bg-white/60 p-4">
          <p className="font-semibold">{preview.originalTitle}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            包格式 v{preview.formatVersion} · 导出于 {formatDate(preview.exportedAt)}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--muted)]">
            <Count label="人物" value={preview.counts.people} />
            <Count label="事件" value={preview.counts.events} />
            <Count label="事实与推论" value={preview.counts.claims} />
            <Count label="调查事项" value={preview.counts.investigationItems} />
            <Count label="AI 运行" value={preview.counts.reasoningRuns} />
            <Count label="全部记录" value={preview.counts.totalRows} />
          </dl>
          {preview.warnings.map((warning) => (
            <p className="mt-3 text-xs leading-5 text-[#7b5a18]" key={warning}>
              {warning}
            </p>
          ))}
          <label className="mb-2 mt-4 block text-sm font-semibold" htmlFor="import-case-title">
            导入后的案件名称
          </label>
          <input
            className="w-full rounded-xl border border-[var(--line)] bg-white/80 px-3.5 py-3 text-sm outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)]"
            id="import-case-title"
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            required
            value={title}
          />
          <button
            className="primary-button mt-4 w-full"
            disabled={pending !== null || !title.trim()}
            onClick={confirmImport}
            type="button"
          >
            {pending === "import" ? "正在导入…" : "确认导入为新案件"}
          </button>
        </div>
      )}

      {error && (
        <p aria-live="polite" className="form-message form-message-error">
          {error}
        </p>
      )}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--paper-deep)] px-2.5 py-2">
      <dt>{label}</dt>
      <dd className="font-mono font-semibold text-[var(--ink)]">{value}</dd>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
