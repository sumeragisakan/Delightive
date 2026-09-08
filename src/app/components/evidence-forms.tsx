"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";

import {
  addClaimEventAction,
  addClaimLocationAction,
  addClaimPersonAction,
  addClaimSourceAction,
  createEvidenceClaimAction,
  createSourceAction,
  removeClaimEventAction,
  removeClaimLocationAction,
  removeClaimPersonAction,
  removeClaimSourceAction,
  setEvidenceClaimArchivedAction,
  setSourceArchivedAction,
  updateEvidenceClaimAction,
  updateSourceAction,
} from "../actions";
import { initialActionState, type ActionState } from "../action-state";
import type {
  EvidenceClaim,
  EvidenceSource,
} from "@/db/repositories/evidence-repository";
import type { TimelineEvent } from "@/db/repositories/event-repository";
import type { ClaimEntityRole } from "@/db/schema";

const inputClassName =
  "w-full rounded-xl border border-[var(--line)] bg-white/80 px-3.5 py-3 text-[0.95rem] text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)]/60 focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)]";
const labelClassName =
  "mb-2 block text-sm font-semibold tracking-[-0.01em] text-[var(--ink)]";

type PersonOption = { displayName: string; id: string };
type LocationOption = { id: string; name: string };

export function SourceCreateForm({ caseId }: { caseId: string }) {
  const action = createSourceAction.bind(null, caseId);
  const [state, formAction, pending] = useActionState(
    action,
    initialActionState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useResetOnSuccess(formRef, state);

  return (
    <form action={formAction} className="space-y-4" ref={formRef}>
      <FormField label="来源标题" name="title" state={state}>
        <input
          className={inputClassName}
          id="source-title"
          maxLength={160}
          name="title"
          placeholder="例如：第三章、目击者笔录"
          required
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <FormField label="类型" name="kind" state={state}>
          <select
            className={inputClassName}
            defaultValue="chapter"
            id="source-kind"
            name="kind"
          >
            {Object.entries(sourceKindLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="定位" name="locator" state={state}>
          <input
            className={inputClassName}
            id="source-locator"
            maxLength={300}
            name="locator"
            placeholder="p.42、00:13:08……"
          />
        </FormField>
      </div>
      <FormField label="原文摘录" name="excerpt" state={state}>
        <textarea
          className={`${inputClassName} min-h-28 resize-y`}
          id="source-excerpt"
          maxLength={8_000}
          name="excerpt"
          placeholder="记录支持事实的原文片段……"
        />
      </FormField>
      <FormField label="备注" name="notes" state={state}>
        <textarea
          className={`${inputClassName} min-h-20 resize-y`}
          id="source-notes"
          maxLength={4_000}
          name="notes"
        />
      </FormField>
      <ActionMessage state={state} />
      <button className="secondary-button w-full justify-center" disabled={pending}>
        {pending ? "正在添加…" : "添加来源"}
      </button>
    </form>
  );
}

export function EvidenceClaimCreateForm({
  caseId,
  events,
  locations,
  people,
  sources,
}: {
  caseId: string;
  events: TimelineEvent[];
  locations: LocationOption[];
  people: PersonOption[];
  sources: EvidenceSource[];
}) {
  const id = useId();
  const action = createEvidenceClaimAction.bind(null, caseId);
  const [state, formAction, pending] = useActionState(
    action,
    initialActionState,
  );
  const [kind, setKind] = useState<"fact" | "statement">("fact");
  const formRef = useRef<HTMLFormElement>(null);
  const activeSources = sources.filter((source) => source.archivedAt === null);

  useResetOnSuccess(formRef, state);

  return (
    <form action={formAction} className="evidence-create-form" ref={formRef}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          htmlFor={`${id}-kind`}
          label="内容类型"
          name="kind"
          state={state}
        >
          <select
            className={inputClassName}
            id={`${id}-kind`}
            name="kind"
            onChange={(event) => setKind(event.target.value as "fact" | "statement")}
            value={kind}
          >
            <option value="fact">固定事实</option>
            <option value="statement">人物陈述</option>
          </select>
        </FormField>
        <FormField
          htmlFor={`${id}-status`}
          label="状态"
          name="status"
          state={state}
        >
          <select
            className={inputClassName}
            defaultValue="draft"
            id={`${id}-status`}
            name="status"
          >
            <option value="draft">草稿</option>
            <option value="accepted">已确认</option>
          </select>
        </FormField>
      </div>

      <FormField
        htmlFor={`${id}-content`}
        label={kind === "fact" ? "事实内容" : "陈述内容"}
        name="content"
        state={state}
      >
        <textarea
          className={`${inputClassName} min-h-28 resize-y`}
          id={`${id}-content`}
          maxLength={8_000}
          name="content"
          placeholder={
            kind === "fact"
              ? "只写来源能够支持的事实……"
              : "记录人物声称或说出的内容……"
          }
          required
        />
      </FormField>

      {kind === "statement" && (
        <FormField
          htmlFor={`${id}-speaker`}
          label="发言者"
          name="speakerPersonId"
          state={state}
        >
          <select
            className={inputClassName}
            defaultValue=""
            id={`${id}-speaker`}
            name="speakerPersonId"
          >
            <option value="">发言者未知</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName} · {person.id.slice(0, 6)}
              </option>
            ))}
          </select>
        </FormField>
      )}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <FormField
          htmlFor={`${id}-source`}
          label="主要来源"
          name="sourceId"
          state={state}
        >
          <select
            className={inputClassName}
            defaultValue=""
            id={`${id}-source`}
            name="sourceId"
          >
            <option value="">暂不关联</option>
            {activeSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.title}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          htmlFor={`${id}-source-relation`}
          label="关系"
          name="sourceRelation"
          state={state}
        >
          <select
            className={inputClassName}
            defaultValue="origin"
            id={`${id}-source-relation`}
            name="sourceRelation"
          >
            <option value="origin">原始出处</option>
            <option value="supports">支持</option>
            <option value="contradicts">反证</option>
          </select>
        </FormField>
      </div>

      <details className="rounded-xl border border-[var(--line)] bg-white/45 p-4">
        <summary className="cursor-pointer list-none text-sm font-semibold marker:hidden">
          关联人物、事件或地点
        </summary>
        <div className="mt-4 grid gap-4 border-t border-[var(--line)] pt-4 sm:grid-cols-3">
          <OptionalSelect
            id={`${id}-person`}
            label="相关人物"
            name="personId"
            options={people.map((person) => ({
              id: person.id,
              label: `${person.displayName} · ${person.id.slice(0, 6)}`,
            }))}
          />
          <OptionalSelect
            id={`${id}-event`}
            label="相关事件"
            name="eventId"
            options={events.map((event) => ({ id: event.id, label: event.title }))}
          />
          <OptionalSelect
            id={`${id}-location`}
            label="相关地点"
            name="locationId"
            options={locations.map((location) => ({
              id: location.id,
              label: location.name,
            }))}
          />
        </div>
      </details>

      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-end">
        <FormField
          htmlFor={`${id}-confidence`}
          label="可信度（0–100）"
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
        <p className="pb-3 text-sm leading-6 text-[var(--muted)]">
          “已确认”内容必须有原始或支持来源；草稿可以稍后补充。
        </p>
      </div>

      <input name="personRole" type="hidden" value="subject" />
      <input name="eventRole" type="hidden" value="context" />
      <input name="locationRole" type="hidden" value="context" />
      {kind === "fact" && <input name="speakerPersonId" type="hidden" value="" />}
      <ActionMessage state={state} />
      <button className="primary-button" disabled={pending}>
        {pending ? "正在记录…" : "加入事实层"}
      </button>
    </form>
  );
}

export function SourceEditor({
  caseId,
  source,
}: {
  caseId: string;
  source: EvidenceSource;
}) {
  const id = useId();
  const updateAction = updateSourceAction.bind(null, caseId, source.id);
  const archiveAction = setSourceArchivedAction.bind(
    null,
    caseId,
    source.id,
    source.archivedAt === null,
  );
  const [state, formAction, pending] = useActionState(
    updateAction,
    initialActionState,
  );

  if (source.archivedAt) {
    return (
      <article className="source-summary">
        <p className="font-semibold">{source.title}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          已归档 · 修订 {source.revision}
        </p>
        <form action={archiveAction} className="mt-3">
          <button className="secondary-button" type="submit">
            恢复来源
          </button>
        </form>
      </article>
    );
  }

  return (
    <details className="source-summary">
      <summary className="cursor-pointer list-none marker:hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{source.title}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {sourceKindLabels[source.kind]} · 修订 {source.revision}
            </p>
          </div>
          <span className="record-badge">{source.dependentClaimCount} 引用</span>
        </div>
        {source.locator && (
          <p className="mt-3 font-mono text-xs text-[var(--accent)]">
            {source.locator}
          </p>
        )}
        {source.excerpt && (
          <blockquote className="source-excerpt">{source.excerpt}</blockquote>
        )}
      </summary>
      <form
        action={formAction}
        className="mt-4 space-y-4 border-t border-[var(--line)] pt-4"
      >
        <FormField
          htmlFor={`${id}-title`}
          label="来源标题"
          name="title"
          state={state}
        >
          <input
            className={inputClassName}
            defaultValue={source.title}
            id={`${id}-title`}
            maxLength={160}
            name="title"
            required
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <FormField
            htmlFor={`${id}-kind`}
            label="类型"
            name="kind"
            state={state}
          >
            <select
              className={inputClassName}
              defaultValue={source.kind}
              id={`${id}-kind`}
              name="kind"
            >
              {Object.entries(sourceKindLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            htmlFor={`${id}-locator`}
            label="定位"
            name="locator"
            state={state}
          >
            <input
              className={inputClassName}
              defaultValue={source.locator ?? ""}
              id={`${id}-locator`}
              maxLength={300}
              name="locator"
            />
          </FormField>
        </div>
        <FormField
          htmlFor={`${id}-excerpt`}
          label="原文摘录"
          name="excerpt"
          state={state}
        >
          <textarea
            className={`${inputClassName} min-h-28 resize-y`}
            defaultValue={source.excerpt ?? ""}
            id={`${id}-excerpt`}
            maxLength={8_000}
            name="excerpt"
          />
        </FormField>
        <FormField
          htmlFor={`${id}-notes`}
          label="备注"
          name="notes"
          state={state}
        >
          <textarea
            className={`${inputClassName} min-h-20 resize-y`}
            defaultValue={source.notes}
            id={`${id}-notes`}
            maxLength={4_000}
            name="notes"
          />
        </FormField>
        <ActionMessage state={state} />
        <button className="secondary-button" disabled={pending}>
          {pending ? "保存中…" : "保存来源"}
        </button>
      </form>
      <form action={archiveAction} className="mt-3">
        <button className="danger-button" type="submit">
          归档来源
        </button>
      </form>
    </details>
  );
}

export function EvidenceClaimEditor({
  caseId,
  claim,
  people,
}: {
  caseId: string;
  claim: EvidenceClaim;
  people: PersonOption[];
}) {
  const id = useId();
  const updateAction = updateEvidenceClaimAction.bind(null, caseId, claim.id);
  const [state, formAction, pending] = useActionState(
    updateAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <FormField
        htmlFor={`${id}-content`}
        label={claim.kind === "fact" ? "事实内容" : "陈述内容"}
        name="content"
        state={state}
      >
        <textarea
          className={`${inputClassName} min-h-28 resize-y`}
          defaultValue={claim.content}
          id={`${id}-content`}
          maxLength={8_000}
          name="content"
          required
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          htmlFor={`${id}-status`}
          label="状态"
          name="status"
          state={state}
        >
          <select
            className={inputClassName}
            defaultValue={claim.status}
            id={`${id}-status`}
            name="status"
          >
            {Object.entries(evidenceStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </FormField>
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
      {claim.kind === "statement" ? (
        <FormField
          htmlFor={`${id}-speaker`}
          label="发言者"
          name="speakerPersonId"
          state={state}
        >
          <select
            className={inputClassName}
            defaultValue={claim.speakerPersonId ?? ""}
            id={`${id}-speaker`}
            name="speakerPersonId"
          >
            <option value="">发言者未知</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName} · {person.id.slice(0, 6)}
              </option>
            ))}
          </select>
        </FormField>
      ) : (
        <input name="speakerPersonId" type="hidden" value="" />
      )}
      <ActionMessage state={state} />
      <button className="secondary-button" disabled={pending}>
        {pending ? "保存中…" : "保存内容"}
      </button>
    </form>
  );
}

export function EvidenceClaimArchiveButton({
  archived,
  caseId,
  claimId,
}: {
  archived: boolean;
  caseId: string;
  claimId: string;
}) {
  const action = setEvidenceClaimArchivedAction.bind(
    null,
    caseId,
    claimId,
    !archived,
  );

  return (
    <form action={action}>
      <button className={archived ? "secondary-button" : "danger-button"}>
        {archived ? "恢复到事实层" : "归档内容"}
      </button>
    </form>
  );
}

export function EvidenceLinksManager({
  caseId,
  claim,
  events,
  locations,
  people,
  sources,
}: {
  caseId: string;
  claim: EvidenceClaim;
  events: TimelineEvent[];
  locations: LocationOption[];
  people: PersonOption[];
  sources: EvidenceSource[];
}) {
  const activeSources = sources.filter((source) => source.archivedAt === null);
  const activeProvenanceCount = claim.sources.filter(
    (link) =>
      link.source.archivedAt === null && link.relation !== "contradicts",
  ).length;

  return (
    <div className="space-y-5">
      <LinkGroup label="来源">
        {claim.sources.map((link) => {
          const canRemove =
            claim.status !== "accepted" ||
            link.relation === "contradicts" ||
            activeProvenanceCount > 1;
          const removeAction = removeClaimSourceAction.bind(
            null,
            caseId,
            claim.id,
            link.source.id,
            link.relation,
          );

          return (
            <div
              className={link.isStale ? "evidence-link evidence-link-stale" : "evidence-link"}
              key={`${link.source.id}-${link.relation}`}
            >
              {sourceRelationLabels[link.relation]} · {link.source.title}
              {link.isStale ? " · 待核对" : ""}
              {canRemove && (
                <form action={removeAction}>
                  <button
                    aria-label={`移除来源 ${link.source.title}`}
                    className="alias-remove"
                    type="submit"
                  >
                    ×
                  </button>
                </form>
              )}
            </div>
          );
        })}
        <SourceLinkForm
          action={addClaimSourceAction.bind(null, caseId, claim.id)}
          sources={activeSources}
        />
      </LinkGroup>

      <LinkGroup label="人物">
        {claim.people.map((link) => {
          const removeAction = removeClaimPersonAction.bind(
            null,
            caseId,
            claim.id,
            link.person.id,
            link.role,
          );
          return (
            <RelationChip
              action={removeAction}
              key={`${link.person.id}-${link.role}`}
              label={`${roleLabels[link.role]} · ${link.person.displayName}`}
            />
          );
        })}
        <EntityLinkForm
          action={addClaimPersonAction.bind(null, caseId, claim.id)}
          emptyLabel="选择人物"
          options={people.map((person) => ({
            id: person.id,
            label: `${person.displayName} · ${person.id.slice(0, 6)}`,
          }))}
        />
      </LinkGroup>

      <LinkGroup label="事件">
        {claim.events.map((link) => {
          const removeAction = removeClaimEventAction.bind(
            null,
            caseId,
            claim.id,
            link.event.id,
            link.role,
          );
          return (
            <RelationChip
              action={removeAction}
              key={`${link.event.id}-${link.role}`}
              label={`${roleLabels[link.role]} · ${link.event.title}${link.isStale ? " · 待核对" : ""}`}
              stale={link.isStale}
            />
          );
        })}
        <EntityLinkForm
          action={addClaimEventAction.bind(null, caseId, claim.id)}
          emptyLabel="选择事件"
          options={events.map((event) => ({ id: event.id, label: event.title }))}
        />
      </LinkGroup>

      <LinkGroup label="地点">
        {claim.locations.map((link) => {
          const removeAction = removeClaimLocationAction.bind(
            null,
            caseId,
            claim.id,
            link.location.id,
            link.role,
          );
          return (
            <RelationChip
              action={removeAction}
              key={`${link.location.id}-${link.role}`}
              label={`${roleLabels[link.role]} · ${link.location.name}`}
            />
          );
        })}
        <EntityLinkForm
          action={addClaimLocationAction.bind(null, caseId, claim.id)}
          emptyLabel="选择地点"
          options={locations.map((location) => ({
            id: location.id,
            label: location.name,
          }))}
        />
      </LinkGroup>
    </div>
  );
}

function SourceLinkForm({
  action,
  sources,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  sources: EvidenceSource[];
}) {
  const id = useId();
  const [state, formAction, pending] = useActionState(
    action,
    initialActionState,
  );

  if (sources.length === 0) {
    return <p className="text-sm text-[var(--muted)]">没有可用来源。</p>;
  }

  return (
    <form
      action={formAction}
      className="grid w-full gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]"
    >
      <label className="sr-only" htmlFor={`${id}-source`}>
        来源
      </label>
      <select
        className={inputClassName}
        defaultValue=""
        id={`${id}-source`}
        name="sourceId"
        required
      >
        <option value="">选择来源</option>
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.title}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor={`${id}-relation`}>
        来源关系
      </label>
      <select
        className={inputClassName}
        defaultValue="supports"
        id={`${id}-relation`}
        name="relation"
      >
        <option value="origin">原始出处</option>
        <option value="supports">支持</option>
        <option value="contradicts">反证</option>
      </select>
      <button className="secondary-button justify-center" disabled={pending}>
        {pending ? "添加中…" : "关联"}
      </button>
      <div className="sm:col-span-3">
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

function EntityLinkForm({
  action,
  emptyLabel,
  options,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  emptyLabel: string;
  options: Array<{ id: string; label: string }>;
}) {
  const id = useId();
  const [state, formAction, pending] = useActionState(
    action,
    initialActionState,
  );

  if (options.length === 0) {
    return <p className="text-sm text-[var(--muted)]">暂无可关联对象。</p>;
  }

  return (
    <form
      action={formAction}
      className="grid w-full gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]"
    >
      <label className="sr-only" htmlFor={`${id}-entity`}>
        {emptyLabel}
      </label>
      <select
        className={inputClassName}
        defaultValue=""
        id={`${id}-entity`}
        name="entityId"
        required
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor={`${id}-role`}>
        关联角色
      </label>
      <select
        className={inputClassName}
        defaultValue="context"
        id={`${id}-role`}
        name="role"
      >
        {Object.entries(roleLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <button className="secondary-button justify-center" disabled={pending}>
        {pending ? "添加中…" : "关联"}
      </button>
      <div className="sm:col-span-3">
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

function LinkGroup({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <section>
      <h5 className="mb-2 text-sm font-semibold">{label}</h5>
      <div className="mb-3 flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function RelationChip({
  action,
  label,
  stale = false,
}: {
  action: () => Promise<void>;
  label: string;
  stale?: boolean;
}) {
  return (
    <div className={stale ? "evidence-link evidence-link-stale" : "evidence-link"}>
      {label}
      <form action={action}>
        <button aria-label={`移除关联 ${label}`} className="alias-remove" type="submit">
          ×
        </button>
      </form>
    </div>
  );
}

function OptionalSelect({
  id,
  label,
  name,
  options,
}: {
  id: string;
  label: string;
  name: string;
  options: Array<{ id: string; label: string }>;
}) {
  return (
    <div>
      <label className={labelClassName} htmlFor={id}>
        {label}
      </label>
      <select className={inputClassName} defaultValue="" id={id} name={name}>
        <option value="">暂不关联</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
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

export const sourceKindLabels = {
  chapter: "章节",
  document: "文档",
  image: "图片",
  narration: "叙述",
  other: "其他",
  statement: "证词",
  user: "用户记录",
} as const;

const evidenceStatusLabels = {
  accepted: "已确认",
  draft: "草稿",
  needs_review: "待复核",
  rejected: "已否定",
  superseded: "已取代",
} as const;

const sourceRelationLabels = {
  contradicts: "反证",
  origin: "原始出处",
  supports: "支持",
} as const;

const roleLabels: Record<ClaimEntityRole, string> = {
  context: "背景",
  mentioned: "提及",
  object: "客体",
  speaker: "发言者",
  subject: "主体",
};
