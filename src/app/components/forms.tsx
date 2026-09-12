"use client";

import { useActionState, useEffect, useId, useRef } from "react";

import {
  addPersonAliasAction,
  createCaseAction,
  createPersonAction,
  deletePersonAction,
  removePersonAliasAction,
  setCaseStatusAction,
  updateCaseAction,
  updatePersonAction,
} from "../actions";
import { initialActionState, type ActionState } from "../action-state";
import type { PersonWithAliases } from "@/db/repositories/case-repository";

const inputClassName =
  "w-full rounded-xl border border-[var(--line)] bg-white/80 px-3.5 py-3 text-[0.95rem] text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)]/60 focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)]";
const labelClassName =
  "mb-2 block text-sm font-semibold tracking-[-0.01em] text-[var(--ink)]";

export function CaseCreateForm() {
  const [state, formAction, pending] = useActionState(
    createCaseAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-5">
      <FormField label="案件名称" name="title" state={state}>
        <input
          className={inputClassName}
          id="title"
          maxLength={120}
          name="title"
          placeholder="例如：钟楼旅馆谜案"
          required
        />
      </FormField>

      <FormField label="案件说明" name="description" state={state}>
        <textarea
          className={`${inputClassName} min-h-28 resize-y`}
          id="description"
          maxLength={2_000}
          name="description"
          placeholder="作品、章节范围，或这次调查的目标……"
        />
      </FormField>

      <FormField label="时间轴方式" name="timelineMode" state={state}>
        <select
          className={inputClassName}
          defaultValue="relative"
          id="timelineMode"
          name="timelineMode"
        >
          <option value="relative">相对时间</option>
          <option value="calendar">日历时间</option>
          <option value="ordinal">章节 / 顺序</option>
        </select>
      </FormField>

      <ActionMessage state={state} />
      <button className="primary-button w-full" disabled={pending} type="submit">
        {pending ? "正在建立案件…" : "建立案件档案"}
      </button>
    </form>
  );
}

export function CaseSettingsForm({
  caseFile,
}: {
  caseFile: {
    description: string;
    id: string;
    status: "active" | "archived";
    timelineMode: "relative" | "calendar" | "ordinal";
    title: string;
  };
}) {
  const updateAction = updateCaseAction.bind(null, caseFile.id);
  const statusAction = setCaseStatusAction.bind(
    null,
    caseFile.id,
    caseFile.status === "active" ? "archived" : "active",
  );
  const [state, formAction, pending] = useActionState(
    updateAction,
    initialActionState,
  );

  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-4">
        <FormField
          htmlFor="case-title"
          label="案件名称"
          name="title"
          state={state}
        >
          <input
            className={inputClassName}
            defaultValue={caseFile.title}
            id="case-title"
            maxLength={120}
            name="title"
            required
          />
        </FormField>
        <FormField
          htmlFor="case-description"
          label="案件说明"
          name="description"
          state={state}
        >
          <textarea
            className={`${inputClassName} min-h-24 resize-y`}
            defaultValue={caseFile.description}
            id="case-description"
            maxLength={2_000}
            name="description"
          />
        </FormField>
        <FormField
          htmlFor="case-timeline-mode"
          label="时间轴方式"
          name="timelineMode"
          state={state}
        >
          <select
            className={inputClassName}
            defaultValue={caseFile.timelineMode}
            id="case-timeline-mode"
            name="timelineMode"
          >
            <option value="relative">相对时间</option>
            <option value="calendar">日历时间</option>
            <option value="ordinal">章节 / 顺序</option>
          </select>
        </FormField>
        <ActionMessage state={state} />
        <button className="secondary-button w-full" disabled={pending} type="submit">
          {pending ? "正在保存…" : "保存案件信息"}
        </button>
      </form>

      <div className="border-t border-[var(--line)] pt-5">
        <p className="mb-3 text-sm font-semibold">数据移交与备份</p>
        <div className="grid gap-2">
          <a
            className="secondary-button justify-center"
            download
            href={`/api/cases/${caseFile.id}/export`}
          >
            导出此案件包
          </a>
          <a className="text-button justify-center" download href="/api/backup">
            下载完整 SQLite 备份
          </a>
        </div>
        <p className="mt-2 text-center text-xs leading-5 text-[var(--muted)]">
          案件包适合移交且会省略本机绝对路径；SQLite 备份包含全部案件。
        </p>
      </div>

      <div className="border-t border-[var(--line)] pt-5">
        <form action={statusAction}>
          <button
            className="text-button w-full justify-center"
            type="submit"
          >
            {caseFile.status === "active" ? "归档这个案件" : "恢复这个案件"}
          </button>
        </form>
        <p className="mt-2 text-center text-xs leading-5 text-[var(--muted)]">
          归档不会删除任何人物、事件或推理。
        </p>
      </div>
    </div>
  );
}

export function PersonCreateForm({ caseId }: { caseId: string }) {
  const createAction = createPersonAction.bind(null, caseId);
  const [state, formAction, pending] = useActionState(
    createAction,
    initialActionState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useResetOnSuccess(formRef, state);

  return (
    <form action={formAction} className="space-y-5" ref={formRef}>
      <FormField
        htmlFor="person-display-name"
        label="人物称呼"
        name="displayName"
        state={state}
      >
        <input
          className={inputClassName}
          id="person-display-name"
          maxLength={120}
          name="displayName"
          placeholder="允许与其他人物同名"
          required
        />
      </FormField>
      <FormField
        htmlFor="person-description"
        label="识别说明"
        name="description"
        state={state}
      >
        <textarea
          className={`${inputClassName} min-h-24 resize-y`}
          id="person-description"
          maxLength={2_000}
          name="description"
          placeholder="身份、外貌，或用于区分同名人物的信息……"
        />
      </FormField>
      <FormField
        htmlFor="person-color"
        label="识别颜色"
        name="color"
        state={state}
      >
        <div className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white/80 p-2.5">
          <input
            aria-label="选择人物识别颜色"
            className="h-9 w-12 cursor-pointer rounded-lg border-0 bg-transparent p-0"
            defaultValue="#9f3f2f"
            id="person-color"
            name="color"
            type="color"
          />
          <span className="text-sm text-[var(--muted)]">
            用于时间轴和关系图中的人物标记
          </span>
        </div>
      </FormField>
      <ActionMessage state={state} />
      <button className="primary-button w-full" disabled={pending} type="submit">
        {pending ? "正在加入…" : "加入人物"}
      </button>
    </form>
  );
}

export function PersonCard({
  caseId,
  person,
}: {
  caseId: string;
  person: PersonWithAliases;
}) {
  const formId = useId();
  const updateAction = updatePersonAction.bind(null, caseId, person.id);
  const addAliasAction = addPersonAliasAction.bind(null, caseId, person.id);
  const removeAction = removePersonAliasAction.bind(null, caseId);
  const deleteAction = deletePersonAction.bind(null, caseId, person.id);
  const [updateState, updateFormAction, updatePending] = useActionState(
    updateAction,
    initialActionState,
  );
  const [aliasState, aliasFormAction, aliasPending] = useActionState(
    addAliasAction,
    initialActionState,
  );
  const aliasFormRef = useRef<HTMLFormElement>(null);

  useResetOnSuccess(aliasFormRef, aliasState);

  return (
    <article className="person-card scroll-mt-8" id={`person-${person.id}`}>
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="mt-1 h-12 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: person.color ?? "#9f3f2f" }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold tracking-[-0.025em]">
                {person.displayName}
              </h3>
              <p className="mt-1 font-mono text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                Person · {person.id.slice(0, 8)}
              </p>
            </div>
            <span className="record-badge">
              {person.aliases.length} 个别名
            </span>
          </div>
          <p className="mt-4 min-h-6 text-[0.95rem] leading-7 text-[var(--muted)]">
            {person.description || "尚未记录识别说明。"}
          </p>
        </div>
      </div>

      <div className="mt-5 border-t border-[var(--line)] pt-5">
        <div className="flex flex-wrap gap-2">
          {person.aliases.length > 0 ? (
            person.aliases.map((alias) => (
              <span className="alias-chip" key={alias.id}>
                <span>{alias.alias}</span>
                <span className="alias-kind">{aliasKindLabels[alias.kind]}</span>
                <form action={removeAction.bind(null, alias.id)}>
                  <button
                    aria-label={`移除别名 ${alias.alias}`}
                    className="alias-remove"
                    title="移除别名"
                    type="submit"
                  >
                    ×
                  </button>
                </form>
              </span>
            ))
          ) : (
            <p className="text-sm text-[var(--muted)]">还没有别名或模糊称呼。</p>
          )}
        </div>

        <form
          action={aliasFormAction}
          className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]"
          ref={aliasFormRef}
        >
          <div>
            <label className="sr-only" htmlFor={`${formId}-alias`}>
              新别名
            </label>
            <input
              className={inputClassName}
              id={`${formId}-alias`}
              maxLength={120}
              name="alias"
              placeholder="X、嫌疑人 1 号……"
              required
            />
          </div>
          <div>
            <label className="sr-only" htmlFor={`${formId}-kind`}>
              别名类型
            </label>
            <select
              className={inputClassName}
              defaultValue="name"
              id={`${formId}-kind`}
              name="kind"
            >
              <option value="name">姓名</option>
              <option value="code">代号</option>
              <option value="description">描述</option>
              <option value="unknown">未知</option>
            </select>
          </div>
          <button
            className="secondary-button justify-center"
            disabled={aliasPending}
            type="submit"
          >
            {aliasPending ? "添加中…" : "添加别名"}
          </button>
        </form>
        <ActionMessage state={aliasState} />
      </div>

      <details className="mt-5 border-t border-[var(--line)] pt-4">
        <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--accent)] marker:hidden">
          编辑人物资料
        </summary>
        <form action={updateFormAction} className="mt-5 space-y-4">
          <FormField
            htmlFor={`${formId}-display-name`}
            label="人物称呼"
            name="displayName"
            state={updateState}
          >
            <input
              className={inputClassName}
              defaultValue={person.displayName}
              id={`${formId}-display-name`}
              maxLength={120}
              name="displayName"
              required
            />
          </FormField>
          <FormField
            htmlFor={`${formId}-description`}
            label="识别说明"
            name="description"
            state={updateState}
          >
            <textarea
              className={`${inputClassName} min-h-24 resize-y`}
              defaultValue={person.description}
              id={`${formId}-description`}
              maxLength={2_000}
              name="description"
            />
          </FormField>
          <FormField
            htmlFor={`${formId}-color`}
            label="识别颜色"
            name="color"
            state={updateState}
          >
            <input
              aria-label="选择人物识别颜色"
              className="h-10 w-16 cursor-pointer rounded-lg border border-[var(--line)] bg-white p-1"
              defaultValue={person.color ?? "#9f3f2f"}
              id={`${formId}-color`}
              name="color"
              type="color"
            />
          </FormField>
          <ActionMessage state={updateState} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              className="secondary-button"
              disabled={updatePending}
              type="submit"
            >
              {updatePending ? "保存中…" : "保存修改"}
            </button>
          </div>
        </form>
        <form
          action={deleteAction}
          className="mt-4"
          onSubmit={(event) => {
            if (!window.confirm(`确定移除“${person.displayName}”吗？相关参与记录也会被移除。`)) {
              event.preventDefault();
            }
          }}
        >
          <button className="danger-button" type="submit">
            从案件中移除
          </button>
        </form>
      </details>
    </article>
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
  htmlFor?: string;
  label: string;
  name: string;
  state: ActionState;
}) {
  const errors = state.fieldErrors?.[name];

  return (
    <div>
      <label className={labelClassName} htmlFor={htmlFor ?? name}>
        {label}
      </label>
      {children}
      {errors?.map((error) => (
        <p className="mt-1.5 text-sm text-[var(--danger)]" key={error}>
          {error}
        </p>
      ))}
    </div>
  );
}

function ActionMessage({ state }: { state: ActionState }) {
  if (!state.message) {
    return null;
  }

  return (
    <p
      aria-live="polite"
      className={
        state.status === "success"
          ? "form-message form-message-success"
          : "form-message form-message-error"
      }
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
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [formRef, state.status]);
}

const aliasKindLabels = {
  code: "代号",
  description: "描述",
  name: "姓名",
  unknown: "未知",
} as const;
