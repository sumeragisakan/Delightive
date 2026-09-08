"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import {
  addEventParticipantAction,
  createEventAction,
  createLocationAction,
  removeEventParticipantAction,
  setEventArchivedAction,
  updateEventAction,
  updateEventParticipantAction,
  updateLocationAction,
} from "../actions";
import { initialActionState, type ActionState } from "../action-state";
import type {
  TimelineEvent,
  TimelineParticipant,
} from "@/db/repositories/event-repository";

const inputClassName =
  "w-full rounded-xl border border-[var(--line)] bg-white/80 px-3.5 py-3 text-[0.95rem] text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)]/60 focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)]";
const labelClassName =
  "mb-2 block text-sm font-semibold tracking-[-0.01em] text-[var(--ink)]";

type LocationOption = {
  description: string;
  id: string;
  name: string;
  parentLocationId: string | null;
  sortOrder: number;
};

type EventOption = Pick<TimelineEvent, "archivedAt" | "id" | "title">;

type PersonOption = {
  color: string | null;
  displayName: string;
  id: string;
};

type EditableEvent = Pick<
  TimelineEvent,
  | "anchorEventId"
  | "certainty"
  | "description"
  | "displayTime"
  | "endOffsetSeconds"
  | "id"
  | "locationId"
  | "relativeOffsetSeconds"
  | "sortOrder"
  | "startOffsetSeconds"
  | "timeKind"
  | "title"
>;

export function LocationCreateForm({
  caseId,
  locations,
}: {
  caseId: string;
  locations: LocationOption[];
}) {
  const action = createLocationAction.bind(null, caseId);
  const [state, formAction, pending] = useActionState(
    action,
    initialActionState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useResetOnSuccess(formRef, state);

  return (
    <form action={formAction} className="space-y-4" ref={formRef}>
      <FormField label="地点名称" name="name" state={state}>
        <input
          className={inputClassName}
          id="location-name"
          maxLength={120}
          name="name"
          placeholder="例如：旅馆二楼"
          required
        />
      </FormField>
      <FormField label="上级地点" name="parentLocationId" state={state}>
        <select
          className={inputClassName}
          defaultValue=""
          id="location-parent"
          name="parentLocationId"
        >
          <option value="">无（顶层地点）</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </FormField>
      <input name="description" type="hidden" value="" />
      <input name="sortOrder" type="hidden" value="0" />
      <ActionMessage state={state} />
      <button className="secondary-button w-full justify-center" disabled={pending}>
        {pending ? "正在添加…" : "添加地点"}
      </button>
    </form>
  );
}

export function LocationEditor({
  caseId,
  location,
  locations,
}: {
  caseId: string;
  location: LocationOption;
  locations: LocationOption[];
}) {
  const id = useId();
  const action = updateLocationAction.bind(null, caseId, location.id);
  const [state, formAction, pending] = useActionState(
    action,
    initialActionState,
  );

  return (
    <details className="location-editor">
      <summary className="cursor-pointer list-none marker:hidden">
        <span className="font-semibold">{location.name}</span>
        <span className="ml-2 text-xs text-[var(--muted)]">
          {location.parentLocationId ? "子地点" : "顶层"}
        </span>
      </summary>
      <form action={formAction} className="mt-4 space-y-4">
        <FormField htmlFor={`${id}-name`} label="地点名称" name="name" state={state}>
          <input
            className={inputClassName}
            defaultValue={location.name}
            id={`${id}-name`}
            maxLength={120}
            name="name"
            required
          />
        </FormField>
        <FormField
          htmlFor={`${id}-parent`}
          label="上级地点"
          name="parentLocationId"
          state={state}
        >
          <select
            className={inputClassName}
            defaultValue={location.parentLocationId ?? ""}
            id={`${id}-parent`}
            name="parentLocationId"
          >
            <option value="">无（顶层地点）</option>
            {locations
              .filter((option) => option.id !== location.id)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
          </select>
        </FormField>
        <FormField
          htmlFor={`${id}-description`}
          label="地点说明"
          name="description"
          state={state}
        >
          <textarea
            className={`${inputClassName} min-h-20 resize-y`}
            defaultValue={location.description}
            id={`${id}-description`}
            maxLength={2_000}
            name="description"
          />
        </FormField>
        <input name="sortOrder" type="hidden" value={location.sortOrder} />
        <ActionMessage state={state} />
        <button className="secondary-button" disabled={pending}>
          {pending ? "保存中…" : "保存地点"}
        </button>
      </form>
    </details>
  );
}

export function EventForm({
  caseId,
  event,
  eventOptions,
  locations,
}: {
  caseId: string;
  event?: EditableEvent;
  eventOptions: EventOption[];
  locations: LocationOption[];
}) {
  const id = useId();
  const action = event
    ? updateEventAction.bind(null, caseId, event.id)
    : createEventAction.bind(null, caseId);
  const [state, formAction, pending] = useActionState(
    action,
    initialActionState,
  );
  const [timeKind, setTimeKind] = useState(event?.timeKind ?? "unknown");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!event && state.status === "success") {
      formRef.current?.reset();
    }
  }, [event, state.status]);

  return (
    <form action={formAction} className="space-y-4" ref={formRef}>
      <FormField htmlFor={`${id}-title`} label="事件标题" name="title" state={state}>
        <input
          className={inputClassName}
          defaultValue={event?.title}
          id={`${id}-title`}
          maxLength={160}
          name="title"
          placeholder="例如：走廊的灯熄灭"
          required
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          htmlFor={`${id}-time-kind`}
          label="时间类型"
          name="timeKind"
          state={state}
        >
          <select
            className={inputClassName}
            id={`${id}-time-kind`}
            name="timeKind"
            onChange={(changeEvent) => setTimeKind(changeEvent.target.value as EditableEvent["timeKind"])}
            value={timeKind}
          >
            <option value="unknown">时间未定</option>
            <option value="exact">准确时间</option>
            <option value="approximate">大约时间</option>
            <option value="range">时间范围</option>
            <option value="relative">相对另一事件</option>
          </select>
        </FormField>
        <FormField
          htmlFor={`${id}-display-time`}
          label="作品中的写法"
          name="displayTime"
          state={state}
        >
          <input
            className={inputClassName}
            defaultValue={event?.displayTime ?? ""}
            id={`${id}-display-time`}
            maxLength={120}
            name="displayTime"
            placeholder="午夜前、第三章末尾……"
          />
        </FormField>
      </div>

      {["exact", "approximate", "range"].includes(timeKind) && (
        <div className={`grid gap-4 ${timeKind === "range" ? "sm:grid-cols-2" : ""}`}>
          <FormField
            htmlFor={`${id}-start`}
            label="起点偏移（时:分:秒）"
            name="startOffsetSeconds"
            state={state}
          >
            <input
              className={inputClassName}
              defaultValue={formatDurationInput(event?.startOffsetSeconds)}
              id={`${id}-start`}
              name="startOffsetSeconds"
              placeholder="00:12:30"
              required
            />
          </FormField>
          {timeKind === "range" && (
            <FormField
              htmlFor={`${id}-end`}
              label="终点偏移（时:分:秒）"
              name="endOffsetSeconds"
              state={state}
            >
              <input
                className={inputClassName}
                defaultValue={formatDurationInput(event?.endOffsetSeconds)}
                id={`${id}-end`}
                name="endOffsetSeconds"
                placeholder="00:14:00"
                required
              />
            </FormField>
          )}
        </div>
      )}

      {timeKind === "relative" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            htmlFor={`${id}-anchor`}
            label="参照事件"
            name="anchorEventId"
            state={state}
          >
            <select
              className={inputClassName}
              defaultValue={event?.anchorEventId ?? ""}
              id={`${id}-anchor`}
              name="anchorEventId"
              required
            >
              <option value="">选择参照事件</option>
              {eventOptions
                .filter(
                  (option) => option.archivedAt === null && option.id !== event?.id,
                )
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                  </option>
                ))}
            </select>
          </FormField>
          <FormField
            htmlFor={`${id}-relative-offset`}
            label="相对偏移（时:分:秒）"
            name="relativeOffsetSeconds"
            state={state}
          >
            <input
              className={inputClassName}
              defaultValue={formatDurationInput(event?.relativeOffsetSeconds)}
              id={`${id}-relative-offset`}
              name="relativeOffsetSeconds"
              placeholder="-00:05:00 或 00:00:30"
              required
            />
          </FormField>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          htmlFor={`${id}-location`}
          label="地点"
          name="locationId"
          state={state}
        >
          <select
            className={inputClassName}
            defaultValue={event?.locationId ?? ""}
            id={`${id}-location`}
            name="locationId"
          >
            <option value="">地点未定</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          htmlFor={`${id}-certainty`}
          label="可信度（0–100）"
          name="certainty"
          state={state}
        >
          <input
            className={inputClassName}
            defaultValue={event?.certainty ?? ""}
            id={`${id}-certainty`}
            max={100}
            min={0}
            name="certainty"
            placeholder="留空表示未评估"
            step={1}
            type="number"
          />
        </FormField>
      </div>

      <FormField
        htmlFor={`${id}-description`}
        label="事件说明"
        name="description"
        state={state}
      >
        <textarea
          className={`${inputClassName} min-h-24 resize-y`}
          defaultValue={event?.description}
          id={`${id}-description`}
          maxLength={4_000}
          name="description"
          placeholder="发生了什么，以及仍有哪些模糊之处……"
        />
      </FormField>
      <FormField
        htmlFor={`${id}-sort-order`}
        label="同组排序"
        name="sortOrder"
        state={state}
      >
        <input
          className={inputClassName}
          defaultValue={event?.sortOrder ?? 0}
          id={`${id}-sort-order`}
          name="sortOrder"
          step={1}
          type="number"
        />
      </FormField>

      <ActionMessage state={state} />
      <button className="primary-button w-full" disabled={pending}>
        {pending ? "正在保存…" : event ? "保存事件" : "加入时间轴"}
      </button>
    </form>
  );
}

export function EventArchiveButton({
  archived,
  caseId,
  eventId,
}: {
  archived: boolean;
  caseId: string;
  eventId: string;
}) {
  const action = setEventArchivedAction.bind(null, caseId, eventId, !archived);

  return (
    <form action={action}>
      <button className={archived ? "secondary-button" : "danger-button"}>
        {archived ? "恢复到时间轴" : "归档事件"}
      </button>
    </form>
  );
}

export function ParticipantManager({
  caseId,
  eventId,
  participants,
  people,
}: {
  caseId: string;
  eventId: string;
  participants: TimelineParticipant[];
  people: PersonOption[];
}) {
  const id = useId();
  const action = addEventParticipantAction.bind(null, caseId, eventId);
  const [state, formAction, pending] = useActionState(
    action,
    initialActionState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useResetOnSuccess(formRef, state);

  return (
    <div className="space-y-4">
      {participants.length > 0 && (
        <div className="space-y-2">
          {participants.map((participant) => (
            <ParticipantEditor
              caseId={caseId}
              eventId={eventId}
              key={`${participant.personId}-${participant.role}`}
              participant={participant}
            />
          ))}
        </div>
      )}

      {people.length > 0 ? (
        <form
          action={formAction}
          className="grid gap-3 rounded-xl border border-dashed border-[var(--line)] p-4 sm:grid-cols-2"
          ref={formRef}
        >
          <FormField
            htmlFor={`${id}-person`}
            label="人物"
            name="personId"
            state={state}
          >
            <select
              className={inputClassName}
              defaultValue=""
              id={`${id}-person`}
              name="personId"
              required
            >
              <option value="">选择人物</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName} · {person.id.slice(0, 6)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            htmlFor={`${id}-role`}
            label="角色"
            name="role"
            state={state}
          >
            <select
              className={inputClassName}
              defaultValue="present"
              id={`${id}-role`}
              name="role"
            >
              {Object.entries(participantRoleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            htmlFor={`${id}-presence`}
            label="在场状态"
            name="presence"
            state={state}
          >
            <select
              className={inputClassName}
              defaultValue="confirmed"
              id={`${id}-presence`}
              name="presence"
            >
              {Object.entries(presenceLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            htmlFor={`${id}-notes`}
            label="说明"
            name="notes"
            state={state}
          >
            <input
              className={inputClassName}
              id={`${id}-notes`}
              maxLength={1_000}
              name="notes"
              placeholder="可选"
            />
          </FormField>
          <div className="sm:col-span-2">
            <ActionMessage state={state} />
            <button className="secondary-button mt-2" disabled={pending}>
              {pending ? "添加中…" : "添加参与人物"}
            </button>
          </div>
        </form>
      ) : (
        <p className="rounded-xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
          先在
          <Link className="mx-1 font-semibold text-[var(--accent)]" href={`/cases/${caseId}`}>
            人物模块
          </Link>
          记录角色，才能把他们加入事件。
        </p>
      )}
    </div>
  );
}

function ParticipantEditor({
  caseId,
  eventId,
  participant,
}: {
  caseId: string;
  eventId: string;
  participant: TimelineParticipant;
}) {
  const id = useId();
  const updateAction = updateEventParticipantAction.bind(
    null,
    caseId,
    eventId,
    participant.personId,
    participant.role,
  );
  const removeAction = removeEventParticipantAction.bind(
    null,
    caseId,
    eventId,
    participant.personId,
    participant.role,
  );
  const [state, formAction, pending] = useActionState(
    updateAction,
    initialActionState,
  );

  return (
    <details className="participant-editor">
      <summary className="flex cursor-pointer list-none items-center gap-3 marker:hidden">
        <span
          aria-hidden="true"
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: participant.person.color ?? "#9f3f2f" }}
        />
        <span className="font-semibold">{participant.person.displayName}</span>
        <span className="record-badge ml-auto">
          {participantRoleLabels[participant.role]} · {presenceLabels[participant.presence]}
        </span>
      </summary>
      <form action={formAction} className="mt-4 grid gap-3 sm:grid-cols-2">
        <input name="personId" type="hidden" value={participant.personId} />
        <input name="role" type="hidden" value={participant.role} />
        <FormField
          htmlFor={`${id}-presence`}
          label="在场状态"
          name="presence"
          state={state}
        >
          <select
            className={inputClassName}
            defaultValue={participant.presence}
            id={`${id}-presence`}
            name="presence"
          >
            {Object.entries(presenceLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          htmlFor={`${id}-notes`}
          label="说明"
          name="notes"
          state={state}
        >
          <input
            className={inputClassName}
            defaultValue={participant.notes}
            id={`${id}-notes`}
            maxLength={1_000}
            name="notes"
          />
        </FormField>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button className="secondary-button" disabled={pending}>
            {pending ? "保存中…" : "保存参与信息"}
          </button>
        </div>
        <div className="sm:col-span-2">
          <ActionMessage state={state} />
        </div>
      </form>
      <form action={removeAction} className="mt-2">
        <button className="text-button" type="submit">
          从事件中移除
        </button>
      </form>
    </details>
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

function formatDurationInput(value: number | null | undefined) {
  if (value == null) {
    return "";
  }

  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const hours = Math.floor(absolute / 3_600);
  const minutes = Math.floor((absolute % 3_600) / 60);
  const seconds = absolute % 60;

  return `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const participantRoleLabels = {
  actor: "行动者",
  mentioned: "被提及",
  other: "其他",
  present: "在场者",
  victim: "受害者",
  witness: "目击者",
} as const;

const presenceLabels = {
  claimed: "声称在场",
  confirmed: "确认在场",
  denied: "确认不在场",
  possible: "可能在场",
} as const;
