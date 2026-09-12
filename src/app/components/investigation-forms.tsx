"use client";

import { useActionState, useEffect, useId, useRef } from "react";

import {
  changeInvestigationStatusAction,
  completeInvestigationAction,
  createInvestigationAction,
  updateInvestigationAction,
} from "../actions";
import { initialActionState, type ActionState } from "../action-state";
import type { InvestigationItemView } from "@/db/repositories/investigation-repository";

const inputClassName =
  "w-full rounded-xl border border-[var(--line)] bg-white/80 px-3.5 py-3 text-[0.95rem] text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)]/60 focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)]";
const labelClassName =
  "mb-2 block text-sm font-semibold tracking-[-0.01em] text-[var(--ink)]";

export type InvestigationFormOptions = {
  claims: Array<{ content: string; id: string; kind: string; revision: number }>;
  events: Array<{ id: string; revision: number; title: string }>;
  locations: Array<{ id: string; name: string }>;
  people: Array<{ displayName: string; id: string }>;
  sources: Array<{ id: string; kind: string; revision: number; title: string }>;
};

export function InvestigationCreateForm({
  branchId,
  caseId,
  options,
}: {
  branchId: string;
  caseId: string;
  options: InvestigationFormOptions;
}) {
  const action = createInvestigationAction.bind(null, caseId, branchId);
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  useResetOnSuccess(formRef, state);

  return (
    <form action={formAction} className="space-y-5" ref={formRef}>
      <InvestigationDetailsFields options={options} state={state} />
      <ActionMessage state={state} />
      <button className="primary-button w-full" disabled={pending} type="submit">
        {pending ? "正在建立…" : "加入调查队列"}
      </button>
    </form>
  );
}

export function InvestigationEditor({
  caseId,
  item,
  options,
}: {
  caseId: string;
  item: InvestigationItemView;
  options: InvestigationFormOptions;
}) {
  const action = updateInvestigationAction.bind(null, caseId, item.id);
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const defaults = {
    claimIds: item.claims.filter(({ role }) => role === "context").map(({ claim }) => claim.id),
    eventIds: item.events.map(({ event }) => event.id),
    locationIds: item.locations.map(({ location }) => location.id),
    notes: item.notes,
    personIds: item.people.map(({ person }) => person.id),
    priority: item.priority,
    question: item.question,
    sourceIds: item.sources.filter(({ role }) => role !== "result").map(({ source }) => source.id),
    targetClaimId: item.claims.find(({ role }) => role === "target")?.claim.id ?? "",
    title: item.title,
  };

  return (
    <form action={formAction} className="space-y-5">
      <InvestigationDetailsFields defaults={defaults} options={options} state={state} />
      <ActionMessage state={state} />
      <button className="secondary-button" disabled={pending} type="submit">
        {pending ? "正在保存…" : "保存调查设置"}
      </button>
    </form>
  );
}

export function InvestigationStatusForm({
  caseId,
  item,
}: {
  caseId: string;
  item: InvestigationItemView;
}) {
  const target =
    item.status === "pending"
      ? "in_progress"
      : item.status === "in_progress"
        ? "pending"
        : "pending";
  const action = changeInvestigationStatusAction.bind(
    null,
    caseId,
    item.id,
    target,
  );
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const label =
    item.status === "pending"
      ? "开始调查"
      : item.status === "in_progress"
        ? "暂放回待处理"
        : "重新打开调查";
  return (
    <form action={formAction} className="mt-4 space-y-3">
      <input name="note" type="hidden" value={label} />
      <button className="secondary-button" disabled={pending} type="submit">
        {pending ? "正在更新…" : label}
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

export function InvestigationCompletionForm({
  caseId,
  itemId,
  people,
  sources,
}: {
  caseId: string;
  itemId: string;
  people: InvestigationFormOptions["people"];
  sources: InvestigationFormOptions["sources"];
}) {
  const action = completeInvestigationAction.bind(null, caseId, itemId);
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const id = useId();

  return (
    <form action={formAction} className="space-y-5">
      <FormField htmlFor={`${id}-outcome`} label="调查结论" name="outcome" state={state}>
        <select className={inputClassName} defaultValue="resolved" id={`${id}-outcome`} name="outcome">
          <option value="resolved">已有结论</option>
          <option value="unresolved">暂时无法确认</option>
        </select>
      </FormField>
      <FormField htmlFor={`${id}-result`} label="结果记录" name="resultSummary" state={state}>
        <textarea
          className={`${inputClassName} min-h-28 resize-y`}
          id={`${id}-result`}
          maxLength={8_000}
          name="resultSummary"
          placeholder="记录查证过程、得到的答案，以及仍然存在的限制……"
          required
        />
      </FormField>

      <details className="rounded-xl border border-[var(--line)] bg-white/45 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--accent)]">
          记录来源（可选）
        </summary>
        <div className="mt-4 space-y-4">
          <FormField htmlFor={`${id}-source-mode`} label="来源方式" name="sourceMode" state={state}>
            <select className={inputClassName} defaultValue="none" id={`${id}-source-mode`} name="sourceMode">
              <option value="none">暂不关联来源</option>
              <option value="existing">选择既有来源</option>
              <option value="new">同时建立新来源</option>
            </select>
          </FormField>
          <FormField htmlFor={`${id}-existing-source`} label="既有来源" name="existingSourceId" state={state}>
            <select className={inputClassName} defaultValue="" id={`${id}-existing-source`} name="existingSourceId">
              <option value="">请选择</option>
              {sources.map((source) => <option key={source.id} value={source.id}>{source.title} · r{source.revision}</option>)}
            </select>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField htmlFor={`${id}-source-title`} label="新来源标题" name="newSourceTitle" state={state}>
              <input className={inputClassName} id={`${id}-source-title`} maxLength={160} name="newSourceTitle" />
            </FormField>
            <FormField htmlFor={`${id}-source-kind`} label="新来源类型" name="newSourceKind" state={state}>
              <select className={inputClassName} defaultValue="user" id={`${id}-source-kind`} name="newSourceKind">
                <option value="user">用户调查</option>
                <option value="chapter">章节</option>
                <option value="statement">证词</option>
                <option value="document">文件</option>
                <option value="image">图像</option>
                <option value="narration">叙述</option>
                <option value="other">其他</option>
              </select>
            </FormField>
          </div>
          <FormField htmlFor={`${id}-source-locator`} label="新来源定位" name="newSourceLocator" state={state}>
            <input className={inputClassName} id={`${id}-source-locator`} maxLength={300} name="newSourceLocator" placeholder="章节、页码或文件位置" />
          </FormField>
          <FormField htmlFor={`${id}-source-excerpt`} label="新来源摘录" name="newSourceExcerpt" state={state}>
            <textarea className={`${inputClassName} min-h-24 resize-y`} id={`${id}-source-excerpt`} maxLength={8_000} name="newSourceExcerpt" />
          </FormField>
          <FormField htmlFor={`${id}-source-notes`} label="新来源备注" name="newSourceNotes" state={state}>
            <textarea className={`${inputClassName} min-h-20 resize-y`} id={`${id}-source-notes`} maxLength={4_000} name="newSourceNotes" />
          </FormField>
        </div>
      </details>

      <details className="rounded-xl border border-[var(--line)] bg-white/45 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--accent)]">
          生成待审核命题（可选）
        </summary>
        <div className="mt-4 space-y-4">
          <p className="text-sm leading-6 text-[var(--muted)]">
            这里生成的内容始终是草稿；需要前往“事实与来源”人工确认后才能成为固定事实。
          </p>
          <FormField htmlFor={`${id}-claim-content`} label="命题内容" name="draftClaimContent" state={state}>
            <textarea className={`${inputClassName} min-h-24 resize-y`} id={`${id}-claim-content`} maxLength={8_000} name="draftClaimContent" />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField htmlFor={`${id}-claim-kind`} label="命题类型" name="draftClaimKind" state={state}>
              <select className={inputClassName} defaultValue="fact" id={`${id}-claim-kind`} name="draftClaimKind">
                <option value="fact">事实草稿</option>
                <option value="statement">人物陈述草稿</option>
              </select>
            </FormField>
            <FormField htmlFor={`${id}-speaker`} label="发言者（陈述时）" name="speakerPersonId" state={state}>
              <select className={inputClassName} defaultValue="" id={`${id}-speaker`} name="speakerPersonId">
                <option value="">未指定</option>
                {people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
              </select>
            </FormField>
          </div>
        </div>
      </details>
      <ActionMessage state={state} />
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? "正在记录…" : "结束调查并记录结果"}
      </button>
    </form>
  );
}

function InvestigationDetailsFields({
  defaults,
  options,
  state,
}: {
  defaults?: {
    claimIds: string[];
    eventIds: string[];
    locationIds: string[];
    notes: string;
    personIds: string[];
    priority: string;
    question: string;
    sourceIds: string[];
    targetClaimId: string;
    title: string;
  };
  options: InvestigationFormOptions;
  state: ActionState;
}) {
  const id = useId();
  return (
    <>
      <FormField htmlFor={`${id}-title`} label="调查标题" name="title" state={state}>
        <input className={inputClassName} defaultValue={defaults?.title} id={`${id}-title`} maxLength={160} name="title" placeholder="例如：核对后门钥匙的保管记录" required />
      </FormField>
      <FormField htmlFor={`${id}-question`} label="待验证问题" name="question" state={state}>
        <textarea className={`${inputClassName} min-h-28 resize-y`} defaultValue={defaults?.question} id={`${id}-question`} maxLength={8_000} name="question" placeholder="写成一个可以通过来源或证据回答的问题……" required />
      </FormField>
      <FormField htmlFor={`${id}-priority`} label="优先级" name="priority" state={state}>
        <select className={inputClassName} defaultValue={defaults?.priority ?? "normal"} id={`${id}-priority`} name="priority">
          <option value="low">低</option>
          <option value="normal">普通</option>
          <option value="high">高</option>
          <option value="urgent">紧急</option>
        </select>
      </FormField>
      <FormField htmlFor={`${id}-notes`} label="调查笔记" name="notes" state={state}>
        <textarea className={`${inputClassName} min-h-24 resize-y`} defaultValue={defaults?.notes} id={`${id}-notes`} maxLength={4_000} name="notes" placeholder="计划、线索或限制条件……" />
      </FormField>
      <details className="rounded-xl border border-[var(--line)] bg-white/45 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--accent)]">
          关联案件内容
        </summary>
        <div className="mt-4 space-y-5">
          <FormField htmlFor={`${id}-target`} label="主要待验证命题" name="targetClaimId" state={state}>
            <select className={inputClassName} defaultValue={defaults?.targetClaimId ?? ""} id={`${id}-target`} name="targetClaimId">
              <option value="">未指定</option>
              {options.claims.map((claim) => <option key={claim.id} value={claim.id}>{truncate(claim.content, 70)} · r{claim.revision}</option>)}
            </select>
          </FormField>
          <Checklist defaultValues={defaults?.claimIds} label="上下文命题" name="claimIds" options={options.claims.map((claim) => ({ id: claim.id, label: `${truncate(claim.content, 74)} · r${claim.revision}` }))} />
          <Checklist defaultValues={defaults?.personIds} label="相关人物" name="personIds" options={options.people.map((person) => ({ id: person.id, label: person.displayName }))} />
          <Checklist defaultValues={defaults?.eventIds} label="相关事件" name="eventIds" options={options.events.map((event) => ({ id: event.id, label: `${event.title} · r${event.revision}` }))} />
          <Checklist defaultValues={defaults?.locationIds} label="相关地点" name="locationIds" options={options.locations.map((location) => ({ id: location.id, label: location.name }))} />
          <Checklist defaultValues={defaults?.sourceIds} label="已有来源" name="sourceIds" options={options.sources.map((source) => ({ id: source.id, label: `${source.title} · r${source.revision}` }))} />
        </div>
      </details>
    </>
  );
}

function Checklist({
  defaultValues = [],
  label,
  name,
  options,
}: {
  defaultValues?: string[];
  label: string;
  name: string;
  options: Array<{ id: string; label: string }>;
}) {
  if (options.length === 0) return null;
  const selected = new Set(defaultValues);
  return (
    <fieldset>
      <legend className={labelClassName}>{label}</legend>
      <div className="grid max-h-48 gap-2 overflow-y-auto rounded-xl border border-[var(--line)] bg-white/60 p-3">
        {options.map((option) => (
          <label className="flex cursor-pointer items-start gap-2 text-sm leading-5" key={option.id}>
            <input className="mt-1 accent-[var(--accent)]" defaultChecked={selected.has(option.id)} name={name} type="checkbox" value={option.id} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
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
  const errors = state.fieldErrors?.[name];
  return (
    <div>
      <label className={labelClassName} htmlFor={htmlFor}>{label}</label>
      {children}
      {errors?.map((error) => <p className="mt-1.5 text-sm text-[var(--danger)]" key={error}>{error}</p>)}
    </div>
  );
}

function ActionMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p aria-live="polite" className={state.status === "success" ? "form-message form-message-success" : "form-message form-message-error"}>
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
