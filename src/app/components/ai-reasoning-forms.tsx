"use client";

import { useActionState, useId } from "react";

import {
  acceptAiSuggestionAction,
  dismissAiSuggestionAction,
  runAiReasoningAction,
} from "../actions";
import { initialActionState, type ActionState } from "../action-state";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--line)] bg-white/75 px-3.5 py-3 text-base outline-none transition focus:border-[var(--accent)]";
const labelClassName = "text-sm font-semibold text-[var(--ink)]";

export function AiRunForm({
  branchId,
  caseId,
  configured,
  focusOptions,
}: {
  branchId: string;
  caseId: string;
  configured: boolean;
  focusOptions: Array<{ content: string; id: string; layer: string }>;
}) {
  const id = useId();
  const action = runAiReasoningAction.bind(null, caseId, branchId);
  const [state, formAction, pending] = useActionState(action, initialActionState);

  return (
    <form action={formAction} className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className={labelClassName} htmlFor={`${id}-mode`}>
            推演任务
          </label>
          <select
            className={inputClassName}
            defaultValue="consistency_check"
            id={`${id}-mode`}
            name="mode"
          >
            <option value="consistency_check">一致性检查</option>
            <option value="hypothesis_expansion">假设扩展</option>
            <option value="counterexample_search">反例搜索</option>
            <option value="investigation_gaps">调查缺口</option>
          </select>
        </div>
        <div>
          <label className={labelClassName} htmlFor={`${id}-focus`}>
            聚焦内容（可选）
          </label>
          <select className={inputClassName} id={`${id}-focus`} name="focusClaimId">
            <option value="">分析整个当前上下文</option>
            {focusOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.layer} · {truncate(option.content, 56)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className={labelClassName} htmlFor={`${id}-prompt`}>
          补充要求（可选）
        </label>
        <textarea
          className={`${inputClassName} min-h-28 resize-y`}
          id={`${id}-prompt`}
          maxLength={4_000}
          name="userPrompt"
          placeholder="例如：重点检查 20:00 到 20:15 之间的不在场证明。"
        />
        {state.fieldErrors?.userPrompt?.map((error) => (
          <p className="mt-1.5 text-sm text-[var(--danger)]" key={error}>
            {error}
          </p>
        ))}
      </div>
      <ActionMessage state={state} />
      <div className="flex flex-wrap items-center gap-3">
        <button className="primary-button" disabled={pending || !configured}>
          {pending ? "模型推演中…" : "开始一次推演"}
        </button>
        <p className="text-xs leading-5 text-[var(--muted)]">
          发送的是当前分支快照；模型输出只会进入待审建议。
        </p>
      </div>
    </form>
  );
}

export function AiSuggestionActions({
  caseId,
  disabled,
  suggestionId,
}: {
  caseId: string;
  disabled: boolean;
  suggestionId: string;
}) {
  const acceptAction = acceptAiSuggestionAction.bind(null, caseId, suggestionId);
  const dismissAction = dismissAiSuggestionAction.bind(null, caseId, suggestionId);
  const [acceptState, acceptFormAction, accepting] = useActionState(
    acceptAction,
    initialActionState,
  );
  const [dismissState, dismissFormAction, dismissing] = useActionState(
    dismissAction,
    initialActionState,
  );

  return (
    <div className="mt-5 border-t border-[var(--line)] pt-4">
      <ActionMessage state={acceptState.message ? acceptState : dismissState} />
      <div className="mt-3 flex flex-wrap gap-2">
        <form action={acceptFormAction}>
          <button
            className="primary-button"
            disabled={disabled || accepting || dismissing}
          >
            {accepting ? "采纳中…" : "转为分支假设"}
          </button>
        </form>
        <form action={dismissFormAction}>
          <button
            className="secondary-button"
            disabled={disabled || accepting || dismissing}
          >
            {dismissing ? "处理中…" : "忽略建议"}
          </button>
        </form>
      </div>
    </div>
  );
}

function ActionMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p
      aria-live="polite"
      className={`form-message ${state.status === "success" ? "form-message-success" : "form-message-error"}`}
    >
      {state.message}
    </p>
  );
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
