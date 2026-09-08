"use client";

import { useActionState, useEffect, useId, useRef } from "react";

import {
  addReasoningArgumentAction,
  createHypothesisAction,
  createReasoningBranchAction,
  demoteInferenceAction,
  promoteHypothesisAction,
  reconfirmInferenceAction,
  rejectReasoningClaimAction,
  removeReasoningArgumentAction,
  reviewReasoningConflictAction,
  setReasoningBranchArchivedAction,
  updateReasoningBranchAction,
  updateReasoningClaimAction,
} from "../actions";
import { initialActionState, type ActionState } from "../action-state";
import type {
  ReasoningBranch,
  ReasoningClaim,
  ReasoningConflict,
} from "@/db/repositories/reasoning-workspace-repository";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--line)] bg-white/75 px-3.5 py-3 text-base outline-none transition focus:border-[var(--accent)]";
const labelClassName = "text-sm font-semibold text-[var(--ink)]";

type PremiseOption = {
  branchName: string | null;
  content: string;
  id: string;
  kind: "fact" | "statement" | "hypothesis" | "inference";
  revision: number;
  status: "draft" | "accepted" | "rejected" | "needs_review" | "superseded";
};

export function BranchCreateForm({
  branches,
  caseId,
  suggestedParentId,
}: {
  branches: ReasoningBranch[];
  caseId: string;
  suggestedParentId?: string | null;
}) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const action = createReasoningBranchAction.bind(null, caseId);
  const [state, formAction, pending] = useActionState(action, initialActionState);
  useResetOnSuccess(formRef, state);

  return (
    <form action={formAction} className="space-y-4" ref={formRef}>
      <FormField htmlFor={`${id}-name`} label="分支名称" name="name" state={state}>
        <input
          className={inputClassName}
          id={`${id}-name`}
          maxLength={120}
          name="name"
          placeholder="例如：X 提前到场"
          required
        />
      </FormField>
      <FormField
        htmlFor={`${id}-parent`}
        label="从哪条分支继续"
        name="parentBranchId"
        state={state}
      >
        <select
          className={inputClassName}
          defaultValue={suggestedParentId ?? ""}
          id={`${id}-parent`}
          name="parentBranchId"
        >
          <option value="">新建根分支</option>
          {branches
            .filter((branch) => branch.status === "active")
            .map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.path.join(" / ")}
              </option>
            ))}
        </select>
      </FormField>
      <FormField
        htmlFor={`${id}-description`}
        label="分支说明"
        name="description"
        state={state}
      >
        <textarea
          className={`${inputClassName} min-h-20 resize-y`}
          id={`${id}-description`}
          maxLength={2_000}
          name="description"
          placeholder="这条路线准备验证什么？"
        />
      </FormField>
      <ActionMessage state={state} />
      <button className="primary-button w-full" disabled={pending}>
        {pending ? "创建中…" : "创建推理分支"}
      </button>
    </form>
  );
}

export function BranchSettingsForm({
  branch,
  branches,
  caseId,
}: {
  branch: ReasoningBranch;
  branches: ReasoningBranch[];
  caseId: string;
}) {
  const id = useId();
  const update = updateReasoningBranchAction.bind(null, caseId, branch.id);
  const archive = setReasoningBranchArchivedAction.bind(
    null,
    caseId,
    branch.id,
    branch.status === "active",
  );
  const [state, formAction, pending] = useActionState(update, initialActionState);
  const [archiveState, archiveFormAction, archivePending] = useActionState(
    archive,
    initialActionState,
  );

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <FormField htmlFor={`${id}-name`} label="名称" name="name" state={state}>
          <input
            className={inputClassName}
            defaultValue={branch.name}
            id={`${id}-name`}
            maxLength={120}
            name="name"
            required
          />
        </FormField>
        <FormField
          htmlFor={`${id}-parent`}
          label="上级分支"
          name="parentBranchId"
          state={state}
        >
          <select
            className={inputClassName}
            defaultValue={branch.parentBranchId ?? ""}
            id={`${id}-parent`}
            name="parentBranchId"
          >
            <option value="">根分支</option>
            {branches
              .filter(
                (candidate) =>
                  candidate.status === "active" && candidate.id !== branch.id,
              )
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.path.join(" / ")}
                </option>
              ))}
          </select>
        </FormField>
        <FormField
          htmlFor={`${id}-description`}
          label="说明"
          name="description"
          state={state}
        >
          <textarea
            className={`${inputClassName} min-h-20 resize-y`}
            defaultValue={branch.description}
            id={`${id}-description`}
            maxLength={2_000}
            name="description"
          />
        </FormField>
        <ActionMessage state={state} />
        <button className="secondary-button" disabled={pending}>
          {pending ? "保存中…" : "保存分支"}
        </button>
      </form>
      <form action={archiveFormAction} className="border-t border-[var(--line)] pt-4">
        <ActionMessage state={archiveState} />
        <button
          className={branch.status === "active" ? "danger-button" : "secondary-button"}
          disabled={archivePending}
        >
          {archivePending
            ? "处理中…"
            : branch.status === "active"
              ? "归档分支"
              : "恢复分支"}
        </button>
      </form>
    </div>
  );
}

export function BranchArchiveToggle({
  archived,
  branchId,
  caseId,
}: {
  archived: boolean;
  branchId: string;
  caseId: string;
}) {
  const action = setReasoningBranchArchivedAction.bind(
    null,
    caseId,
    branchId,
    !archived,
  );
  const [state, formAction, pending] = useActionState(action, initialActionState);

  return (
    <form action={formAction}>
      <ActionMessage state={state} />
      <button className="secondary-button mt-2" disabled={pending}>
        {pending ? "处理中…" : archived ? "恢复分支" : "归档分支"}
      </button>
    </form>
  );
}

export function HypothesisCreateForm({
  branchId,
  caseId,
}: {
  branchId: string;
  caseId: string;
}) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const action = createHypothesisAction.bind(null, caseId, branchId);
  const [state, formAction, pending] = useActionState(action, initialActionState);
  useResetOnSuccess(formRef, state);

  return (
    <form action={formAction} className="grid gap-4" ref={formRef}>
      <FormField htmlFor={`${id}-content`} label="假设" name="content" state={state}>
        <textarea
          className={`${inputClassName} min-h-28 resize-y`}
          id={`${id}-content`}
          maxLength={8_000}
          name="content"
          placeholder="写下一个可以被前提支持或反驳的明确判断。"
          required
        />
      </FormField>
      <div className="max-w-44">
        <FormField
          htmlFor={`${id}-confidence`}
          label="初始可信度（0–100）"
          name="confidence"
          state={state}
        >
          <input
            className={inputClassName}
            id={`${id}-confidence`}
            max={100}
            min={0}
            name="confidence"
            placeholder="未评估"
            step={1}
            type="number"
          />
        </FormField>
      </div>
      <ActionMessage state={state} />
      <button className="primary-button justify-self-start" disabled={pending}>
        {pending ? "记录中…" : "加入当前分支"}
      </button>
    </form>
  );
}

export function ReasoningClaimEditor({
  caseId,
  claim,
}: {
  caseId: string;
  claim: ReasoningClaim;
}) {
  const id = useId();
  const action = updateReasoningClaimAction.bind(null, caseId, claim.id);
  const [state, formAction, pending] = useActionState(action, initialActionState);

  return (
    <form action={formAction} className="space-y-4">
      <FormField htmlFor={`${id}-content`} label="推理内容" name="content" state={state}>
        <textarea
          className={`${inputClassName} min-h-28 resize-y`}
          defaultValue={claim.content}
          id={`${id}-content`}
          maxLength={8_000}
          name="content"
          required
        />
      </FormField>
      <div className="max-w-44">
        <FormField
          htmlFor={`${id}-confidence`}
          label="可信度（0–100）"
          name="confidence"
          state={state}
        >
          <input
            className={inputClassName}
            defaultValue={claim.confidence ?? ""}
            id={`${id}-confidence`}
            max={100}
            min={0}
            name="confidence"
            step={1}
            type="number"
          />
        </FormField>
      </div>
      <ActionMessage state={state} />
      <button className="secondary-button" disabled={pending}>
        {pending ? "保存中…" : "保存内容"}
      </button>
      {claim.status === "accepted" && (
        <p className="text-xs leading-5 text-[var(--muted)]">
          修改可信推论后，它会自动回到待复核状态。
        </p>
      )}
    </form>
  );
}

export function ArgumentManager({
  caseId,
  claim,
  premiseOptions,
}: {
  caseId: string;
  claim: ReasoningClaim;
  premiseOptions: PremiseOption[];
}) {
  const options = premiseOptions.filter((option) => option.id !== claim.id);

  return (
    <div className="space-y-4">
      {claim.premises.length > 0 ? (
        <div className="grid gap-2">
          {claim.premises.map(({ claim: premise, isStale, link }) => (
            <ArgumentRow
              caseId={caseId}
              isStale={isStale}
              key={link.id}
              linkId={link.id}
              premise={premise.content}
              rationale={link.rationale}
              relation={link.relation}
              strength={link.strength}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm leading-6 text-[var(--muted)]">
          还没有前提。至少添加一条支持、依赖或限定关系，才能申请进入可信层。
        </p>
      )}
      {options.length > 0 ? (
        <ArgumentCreateForm
          caseId={caseId}
          conclusionClaimId={claim.id}
          options={options}
        />
      ) : (
        <p className="text-sm text-[var(--muted)]">当前分支没有可引用的前提。</p>
      )}
    </div>
  );
}

function ArgumentRow({
  caseId,
  isStale,
  linkId,
  premise,
  rationale,
  relation,
  strength,
}: {
  caseId: string;
  isStale: boolean;
  linkId: string;
  premise: string;
  rationale: string;
  relation: "supports" | "contradicts" | "depends_on" | "qualifies";
  strength: number | null;
}) {
  const action = removeReasoningArgumentAction.bind(null, caseId, linkId);
  const [state, formAction, pending] = useActionState(action, initialActionState);

  return (
    <div className={isStale ? "argument-row argument-row-stale" : "argument-row"}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`argument-relation argument-relation-${relation}`}>
            {relationLabels[relation]}
          </span>
          {strength !== null && <span className="text-xs text-[var(--muted)]">强度 {strength}</span>}
          {isStale && <span className="text-xs font-semibold text-[#765718]">版本已变化</span>}
        </div>
        <p className="mt-2 text-sm leading-6">{premise}</p>
        {rationale && <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{rationale}</p>}
        <ActionMessage state={state} />
      </div>
      <form action={formAction}>
        <button className="alias-remove" disabled={pending} title="移除关系" type="submit">
          ×
        </button>
      </form>
    </div>
  );
}

function ArgumentCreateForm({
  caseId,
  conclusionClaimId,
  options,
}: {
  caseId: string;
  conclusionClaimId: string;
  options: PremiseOption[];
}) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const action = addReasoningArgumentAction.bind(null, caseId, conclusionClaimId);
  const [state, formAction, pending] = useActionState(action, initialActionState);
  useResetOnSuccess(formRef, state);

  return (
    <form action={formAction} className="argument-create" ref={formRef}>
      <div className="sm:col-span-2">
        <label className={labelClassName} htmlFor={`${id}-premise`}>
          引用前提
        </label>
        <select className={inputClassName} defaultValue="" id={`${id}-premise`} name="premiseClaimId" required>
          <option value="">选择事实、可信推论或本分支草稿</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {kindLabels[option.kind]} · {truncate(option.content, 54)}
              {option.branchName ? ` · ${option.branchName}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClassName} htmlFor={`${id}-relation`}>
          关系
        </label>
        <select className={inputClassName} defaultValue="supports" id={`${id}-relation`} name="relation">
          {Object.entries(relationLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClassName} htmlFor={`${id}-strength`}>
          强度（0–100）
        </label>
        <input className={inputClassName} id={`${id}-strength`} max={100} min={0} name="strength" placeholder="未评估" type="number" />
      </div>
      <div className="sm:col-span-2">
        <label className={labelClassName} htmlFor={`${id}-rationale`}>
          为什么有关
        </label>
        <textarea className={`${inputClassName} min-h-20 resize-y`} id={`${id}-rationale`} maxLength={2_000} name="rationale" />
      </div>
      <div className="sm:col-span-2">
        <ActionMessage state={state} />
        <button className="secondary-button mt-2" disabled={pending}>
          {pending ? "添加中…" : "添加论证关系"}
        </button>
      </div>
    </form>
  );
}

export function ClaimReviewForm({
  caseId,
  claim,
}: {
  caseId: string;
  claim: ReasoningClaim;
}) {
  if (claim.status === "rejected" || claim.status === "superseded") {
    return (
      <p className="text-sm leading-6 text-[var(--muted)]">
        这条推理已退出当前审查流程；记录仍保留在分支中。
      </p>
    );
  }

  const mode =
    claim.kind === "hypothesis"
      ? "promote"
      : claim.status === "needs_review"
        ? "reconfirm"
        : "demote";
  const action =
    mode === "promote"
      ? promoteHypothesisAction.bind(null, caseId, claim.id)
      : mode === "reconfirm"
        ? reconfirmInferenceAction.bind(null, caseId, claim.id)
        : demoteInferenceAction.bind(null, caseId, claim.id);
  const rejectAction = rejectReasoningClaimAction.bind(null, caseId, claim.id);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <ReviewActionForm
        action={action}
        buttonLabel={
          mode === "promote"
            ? "晋升为可信推论"
            : mode === "reconfirm"
              ? "按当前前提重新确认"
              : "转入待复核"
        }
        primary={mode !== "demote"}
      />
      {claim.status !== "accepted" && (
        <ReviewActionForm action={rejectAction} buttonLabel="否定这条推理" danger />
      )}
    </div>
  );
}

function ReviewActionForm({
  action,
  buttonLabel,
  danger = false,
  primary = false,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  buttonLabel: string;
  danger?: boolean;
  primary?: boolean;
}) {
  const id = useId();
  const [state, formAction, pending] = useActionState(action, initialActionState);

  return (
    <form action={formAction} className="rounded-xl border border-[var(--line)] bg-white/45 p-3">
      <label className={labelClassName} htmlFor={`${id}-note`}>
        审查说明（可选）
      </label>
      <textarea className={`${inputClassName} min-h-20 resize-y`} id={`${id}-note`} maxLength={2_000} name="note" />
      <ActionMessage state={state} />
      <button
        className={danger ? "danger-button mt-3" : primary ? "primary-button mt-3" : "secondary-button mt-3"}
        disabled={pending}
      >
        {pending ? "处理中…" : buttonLabel}
      </button>
    </form>
  );
}

export function ConflictReviewForm({
  caseId,
  conflict,
}: {
  caseId: string;
  conflict: ReasoningConflict;
}) {
  const id = useId();
  const action = reviewReasoningConflictAction.bind(null, caseId, conflict.link.id);
  const [state, formAction, pending] = useActionState(action, initialActionState);

  return (
    <form action={formAction} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <div>
        <label className={labelClassName} htmlFor={`${id}-decision`}>
          人工处置
        </label>
        <select className={inputClassName} defaultValue="retained" id={`${id}-decision`} name="decision">
          <option value="retained">保留矛盾，允许继续</option>
          <option value="prefer_premise">暂取左侧，右侧待复核</option>
          <option value="prefer_conclusion">暂取右侧，左侧待复核</option>
          <option value="both_review">双方都转入待复核</option>
          <option value="dismissed">判定并非真正矛盾</option>
        </select>
      </div>
      <button className="secondary-button justify-center" disabled={pending}>
        {pending ? "记录中…" : "记录处置"}
      </button>
      <div className="sm:col-span-2">
        <label className={labelClassName} htmlFor={`${id}-note`}>
          判断依据（可选）
        </label>
        <textarea className={`${inputClassName} min-h-20 resize-y`} id={`${id}-note`} maxLength={2_000} name="note" />
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

function FormField({
  children,
  htmlFor,
  label,
  name,
  state,
}: {
  children: React.ReactNode;
  htmlFor: string;
  label: string;
  name: string;
  state: ActionState;
}) {
  return (
    <div>
      <label className={labelClassName} htmlFor={htmlFor}>{label}</label>
      {children}
      {state.fieldErrors?.[name]?.map((error) => (
        <p className="mt-1.5 text-sm text-[var(--danger)]" key={error}>{error}</p>
      ))}
    </div>
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

function useResetOnSuccess(
  formRef: React.RefObject<HTMLFormElement | null>,
  state: ActionState,
) {
  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [formRef, state.status]);
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

export const relationLabels = {
  supports: "支持",
  contradicts: "矛盾",
  depends_on: "依赖",
  qualifies: "限定",
} as const;

const kindLabels = {
  fact: "事实",
  statement: "陈述",
  hypothesis: "假设",
  inference: "推论",
} as const;
