"use client";

import { useActionState, useId } from "react";

import {
  diagnoseAiConnectionAction,
  updateAiSettingsAction,
} from "../actions";
import {
  initialActionState,
  initialAiDiagnosticState,
  type ActionState,
} from "../action-state";
import type { AiSettingsView } from "@/db/services/ai-settings-service";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--line)] bg-white/75 px-3.5 py-3 text-sm outline-none transition focus:border-[var(--accent)]";

export function AiSettingsPanel({
  caseId,
  settings,
}: {
  caseId: string;
  settings: AiSettingsView;
}) {
  const id = useId();
  const saveAction = updateAiSettingsAction.bind(null, caseId);
  const diagnosticAction = diagnoseAiConnectionAction.bind(null, caseId);
  const [saveState, saveFormAction, saving] = useActionState(
    saveAction,
    initialActionState,
  );
  const [diagnosticState, diagnosticFormAction, diagnosing] = useActionState(
    diagnosticAction,
    initialAiDiagnosticState,
  );

  return (
    <section className="border-t border-[var(--line)] pt-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">AI 设置</p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            {settings.source === "saved" ? "SQLite 已保存设置" : "当前使用环境变量默认值"}
          </p>
        </div>
        <span
          className={`evidence-status evidence-status-${settings.configured ? "accepted" : "rejected"}`}
        >
          {settings.configured ? "可运行" : settings.enabled ? "缺少密钥" : "已停用"}
        </span>
      </div>

      <form action={saveFormAction} className="mt-4 grid gap-4">
        <input name="provider" type="hidden" value="openai" />
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--line)] bg-white/45 p-3 text-sm">
          <input
            className="mt-1 accent-[var(--accent)]"
            defaultChecked={settings.enabled}
            name="enabled"
            type="checkbox"
          />
          <span>
            <span className="block font-semibold">启用 AI 推演</span>
            <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
              停用后不会发送新的模型请求。
            </span>
          </span>
        </label>
        <div>
          <label className="text-xs font-semibold" htmlFor={`${id}-model`}>
            OpenAI 模型 ID
          </label>
          <input
            className={inputClassName}
            defaultValue={settings.model}
            id={`${id}-model`}
            maxLength={120}
            name="model"
            required
          />
          <FieldErrors errors={saveState.fieldErrors?.model} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold" htmlFor={`${id}-timeout`}>
              超时（毫秒）
            </label>
            <input
              className={inputClassName}
              defaultValue={settings.timeoutMs}
              id={`${id}-timeout`}
              max={180000}
              min={5000}
              name="timeoutMs"
              required
              step={1000}
              type="number"
            />
            <FieldErrors errors={saveState.fieldErrors?.timeoutMs} />
          </div>
          <div>
            <label className="text-xs font-semibold" htmlFor={`${id}-tokens`}>
              输出上限
            </label>
            <input
              className={inputClassName}
              defaultValue={settings.maxOutputTokens}
              id={`${id}-tokens`}
              max={10000}
              min={256}
              name="maxOutputTokens"
              required
              step={1}
              type="number"
            />
            <FieldErrors errors={saveState.fieldErrors?.maxOutputTokens} />
          </div>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-white/40 p-3 text-xs leading-5 text-[var(--muted)]">
          <p>Provider · OpenAI Responses API</p>
          <p>接口主机 · {settings.endpointHost}</p>
          <p>服务端密钥 · {settings.apiKeyConfigured ? "已检测到" : "未配置"}</p>
        </div>
        <ActionMessage state={saveState} />
        <button className="secondary-button justify-self-start" disabled={saving}>
          {saving ? "保存中…" : "保存运行设置"}
        </button>
      </form>

      <form
        action={diagnosticFormAction}
        className="mt-4 border-t border-[var(--line)] pt-4"
      >
        <p className="text-xs leading-5 text-[var(--muted)]">
          使用已保存设置发送一条不含案件材料的最小请求，验证密钥、模型权限与 Responses API。
        </p>
        <button className="secondary-button mt-3" disabled={diagnosing}>
          {diagnosing ? "诊断中…" : "测试当前连接"}
        </button>
        <ActionMessage state={diagnosticState} />
        {diagnosticState.diagnostic && (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl border border-[var(--line)] bg-white/40 p-3 text-xs leading-5">
            <dt className="text-[var(--muted)]">结果</dt>
            <dd>{diagnosticState.diagnostic.code}</dd>
            <dt className="text-[var(--muted)]">模型</dt>
            <dd>{diagnosticState.diagnostic.model}</dd>
            <dt className="text-[var(--muted)]">耗时</dt>
            <dd>
              {diagnosticState.diagnostic.durationMs === null
                ? "未发送请求"
                : `${diagnosticState.diagnostic.durationMs} ms`}
            </dd>
            {diagnosticState.diagnostic.traceId && (
              <>
                <dt className="text-[var(--muted)]">追踪 ID</dt>
                <dd className="min-w-0 break-all font-mono">
                  {diagnosticState.diagnostic.traceId}
                </dd>
              </>
            )}
          </dl>
        )}
      </form>
    </section>
  );
}

function FieldErrors({ errors }: { errors?: string[] }) {
  return errors?.map((error) => (
    <p className="mt-1.5 text-xs text-[var(--danger)]" key={error}>
      {error}
    </p>
  ));
}

function ActionMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p
      aria-live="polite"
      className={`form-message mt-3 ${state.status === "success" ? "form-message-success" : "form-message-error"}`}
    >
      {state.message}
    </p>
  );
}
