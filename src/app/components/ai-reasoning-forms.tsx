"use client";

import { useActionState, useId } from "react";

import {
  acceptAiSuggestionAction,
  dismissAiSuggestionAction,
  editAiSuggestionAction,
  retryAiReasoningAction,
  runAiReasoningAction,
} from "../actions";
import { initialActionState, type ActionState } from "../action-state";
import type {
  EditableSuggestion,
} from "@/db/repositories/ai-reasoning-repository";
import type { ReasoningSuggestionKind } from "@/db/schema";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--line)] bg-white/75 px-3.5 py-3 text-base outline-none transition focus:border-[var(--accent)]";
const labelClassName = "text-sm font-semibold text-[var(--ink)]";

export function AiRunForm({
  branchId,
  caseId,
  configured,
  focusOptions,
  requestKey,
}: {
  branchId: string;
  caseId: string;
  configured: boolean;
  focusOptions: Array<{ content: string; id: string; layer: string }>;
  requestKey: string;
}) {
  const id = useId();
  const action = runAiReasoningAction.bind(null, caseId, branchId);
  const [state, formAction, pending] = useActionState(action, initialActionState);

  return (
    <form action={formAction} className="grid gap-5">
      <input name="requestKey" type="hidden" value={requestKey} />
      <fieldset>
        <legend className={labelClassName}>推演任务</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {runModes.map((mode, index) => (
            <label
              className="cursor-pointer rounded-xl border border-[var(--line)] bg-white/55 p-4 transition has-[:checked]:border-[var(--accent)] has-[:checked]:bg-white"
              key={mode.value}
            >
              <span className="flex items-start gap-3">
                <input
                  className="mt-1 accent-[var(--accent)]"
                  defaultChecked={index === 0}
                  name="mode"
                  type="radio"
                  value={mode.value}
                />
                <span>
                  <span className="block text-sm font-semibold">{mode.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                    {mode.description}
                  </span>
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
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
          重复提交会由请求标识合并，不会产生重复 API 调用。
        </p>
      </div>
    </form>
  );
}

export function AiSuggestionReview({
  baseRevision,
  caseId,
  claimLabels,
  disabled,
  effective,
  kind,
  suggestionId,
}: {
  baseRevision: number;
  caseId: string;
  claimLabels: Record<string, string>;
  disabled: boolean;
  effective: EditableSuggestion;
  kind: ReasoningSuggestionKind;
  suggestionId: string;
}) {
  const id = useId();
  const editAction = editAiSuggestionAction.bind(null, caseId, suggestionId);
  const acceptAction = acceptAiSuggestionAction.bind(null, caseId, suggestionId);
  const dismissAction = dismissAiSuggestionAction.bind(null, caseId, suggestionId);
  const [editState, editFormAction, editing] = useActionState(
    editAction,
    initialActionState,
  );
  const [acceptState, acceptFormAction, accepting] = useActionState(
    acceptAction,
    initialActionState,
  );
  const [dismissState, dismissFormAction, dismissing] = useActionState(
    dismissAction,
    initialActionState,
  );
  const citationOptions = uniqueCitationOptions(effective, claimLabels);

  return (
    <div className="mt-5 border-t border-[var(--line)] pt-4">
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-[var(--accent)]">
          采纳前编辑 · 当前人工修订 {baseRevision}
        </summary>
        <form action={editFormAction} className="mt-4 grid gap-4">
          <input name="baseRevision" type="hidden" value={baseRevision} />
          <div>
            <label className={labelClassName} htmlFor={`${id}-title`}>标题</label>
            <input className={inputClassName} defaultValue={effective.title} id={`${id}-title`} maxLength={160} name="title" required />
          </div>
          <div>
            <label className={labelClassName} htmlFor={`${id}-content`}>建议内容</label>
            <textarea className={`${inputClassName} min-h-28 resize-y`} defaultValue={effective.content} id={`${id}-content`} maxLength={8_000} name="content" required />
          </div>
          <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <div>
              <label className={labelClassName} htmlFor={`${id}-confidence`}>可信度</label>
              <input className={inputClassName} defaultValue={effective.confidence} id={`${id}-confidence`} max={100} min={0} name="confidence" required type="number" />
            </div>
            <div>
              <label className={labelClassName} htmlFor={`${id}-rationale`}>判断理由</label>
              <textarea className={`${inputClassName} min-h-24 resize-y`} defaultValue={effective.rationale} id={`${id}-rationale`} maxLength={4_000} name="rationale" required />
            </div>
          </div>
          <fieldset>
            <legend className={labelClassName}>引用关系</legend>
            <div className="mt-2 grid gap-2">
              {effective.citations.map((citation) => (
                <div className="argument-row" key={`${citation.claimId}-${citation.relation}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-6">{claimLabels[citation.claimId] ?? citation.claimId}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">修订 {citation.revision}</p>
                  </div>
                  <div className="w-full sm:w-32">
                    <input name="citationId" type="hidden" value={citation.claimId} />
                    <input name="citationRevision" type="hidden" value={citation.revision} />
                    <select className={inputClassName} defaultValue={citation.relation} name="citationRelation">
                      {Object.entries(relationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
          {(kind === "counterexample" || kind === "contradiction" || kind === "investigation_gap") && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClassName} htmlFor={`${id}-target`}>{kind === "contradiction" ? "冲突左侧" : "主要目标"}</label>
                <select className={inputClassName} defaultValue={effective.targetClaimId ?? ""} id={`${id}-target`} name="targetClaimId" required={kind !== "investigation_gap"}>
                  <option value="">不指定</option>
                  {citationOptions.map((option) => <option key={option.id} value={option.id}>{truncate(option.label, 48)}</option>)}
                </select>
              </div>
              {kind === "contradiction" && (
                <div>
                  <label className={labelClassName} htmlFor={`${id}-secondary`}>冲突右侧</label>
                  <select className={inputClassName} defaultValue={effective.secondaryClaimId ?? ""} id={`${id}-secondary`} name="secondaryClaimId" required>
                    <option value="">选择另一侧</option>
                    {citationOptions.map((option) => <option key={option.id} value={option.id}>{truncate(option.label, 48)}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}
          <div>
            <label className={labelClassName} htmlFor={`${id}-edit-note`}>编辑说明（可选）</label>
            <textarea className={`${inputClassName} min-h-20 resize-y`} id={`${id}-edit-note`} maxLength={2_000} name="editNote" placeholder="记录你为什么调整这条建议。" />
          </div>
          <ActionMessage state={editState} />
          <button className="secondary-button justify-self-start" disabled={disabled || editing}>
            {editing ? "保存中…" : "保存人工修订"}
          </button>
        </form>
      </details>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <form action={acceptFormAction} className="rounded-xl border border-[var(--line)] bg-white/45 p-3">
          <label className={labelClassName} htmlFor={`${id}-accept-note`}>采纳说明（可选）</label>
          <textarea className={`${inputClassName} min-h-16 resize-y`} id={`${id}-accept-note`} maxLength={2_000} name="note" />
          <ActionMessage state={acceptState} />
          <button className="primary-button mt-3" disabled={disabled || accepting || dismissing}>
            {accepting ? "处理中…" : resolutionLabels[kind]}
          </button>
        </form>
        <form action={dismissFormAction} className="rounded-xl border border-[var(--line)] bg-white/45 p-3">
          <label className={labelClassName} htmlFor={`${id}-dismiss-note`}>忽略原因（可选）</label>
          <textarea className={`${inputClassName} min-h-16 resize-y`} id={`${id}-dismiss-note`} maxLength={2_000} name="note" />
          <ActionMessage state={dismissState} />
          <button className="secondary-button mt-3" disabled={accepting || dismissing}>
            {dismissing ? "处理中…" : "忽略并保留记录"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function RetryAiRunForm({
  caseId,
  configured,
  requestKey,
  runId,
}: {
  caseId: string;
  configured: boolean;
  requestKey: string;
  runId: string;
}) {
  const action = retryAiReasoningAction.bind(null, caseId, runId);
  const [state, formAction, pending] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="mt-4">
      <input name="requestKey" type="hidden" value={requestKey} />
      <ActionMessage state={state} />
      <button className="secondary-button mt-2" disabled={!configured || pending}>
        {pending ? "重新推演中…" : "以最新上下文重新运行"}
      </button>
    </form>
  );
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

function uniqueCitationOptions(
  effective: EditableSuggestion,
  claimLabels: Record<string, string>,
) {
  return [...new Set(effective.citations.map(({ claimId }) => claimId))].map((id) => ({
    id,
    label: claimLabels[id] ?? id,
  }));
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

const runModes = [
  { description: "寻找时间、主体和论证之间的不一致。", label: "一致性检查", value: "consistency_check" },
  { description: "提出少量可证伪、可继续验证的新解释。", label: "假设扩展", value: "hypothesis_expansion" },
  { description: "主动削弱现有判断，寻找替代解释。", label: "反例搜索", value: "counterexample_search" },
  { description: "找出最值得补充的证据和调查问题。", label: "调查缺口", value: "investigation_gaps" },
] as const;

const relationLabels = {
  contradicts: "矛盾",
  depends_on: "依赖",
  qualifies: "限定",
  supports: "支持",
} as const;

const resolutionLabels = {
  contradiction: "建立矛盾关系",
  counterexample: "转为反例假设",
  hypothesis: "转为分支假设",
  investigation_gap: "转为待调查事项",
} as const;
