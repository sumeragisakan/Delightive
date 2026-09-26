import { TimelineBasisForm } from "@/app/components/timeline-basis-form";
import { type CaseTimeCoordinates } from "@/app/components/event-time-fields";
import { caseTimeBasisToken, formatResolvedTime } from "@/timeline/time";
import { notFound } from "next/navigation";

import { CaseWorkspaceFrame } from "../../../components/case-workspace-frame";
import {
  EventArchiveButton,
  EventForm,
  LocationCreateForm,
  LocationEditor,
  ParticipantManager,
} from "../../../components/timeline-forms";
import { getTimelineWorkspace } from "../../../data";
import type { TimelineEvent } from "@/db/repositories/event-repository";

export default async function TimelinePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const { caseFile, events, locations, people } =
    await getTimelineWorkspace(caseId);

  if (!caseFile) {
    notFound();
  }

  const coordinates: CaseTimeCoordinates = {
    calendar: caseFile.timelineMode === "calendar" && Boolean(caseFile.timelineOriginAt),
    originDate: caseFile.timelineOriginAt?.toISOString().slice(0, 10) ?? "",
    originLabel: caseFile.timelineOriginLabel ?? "",
    basisToken: caseTimeBasisToken(caseFile.timelineMode, caseFile.timelineOriginAt?.toISOString() ?? null),
  };
  const activeEvents = events.filter((event) => event.archivedAt === null);
  const absoluteEvents = activeEvents.filter((event) => event.resolvedTime.status === "located");
  const relativeEvents = activeEvents.filter(
    (event) => event.timeKind === "relative" && event.resolvedTime.status !== "located",
  );
  const unknownEvents = activeEvents.filter(
    (event) => event.timeKind === "unknown",
  );
  const archivedEvents = events.filter((event) => event.archivedAt !== null);
  const eventTitles = new Map(events.map((event) => [event.id, event.title]));

  return (
    <CaseWorkspaceFrame
      activeModule="timeline"
      aside={
        <div className="space-y-7 lg:sticky lg:top-8">
          <TimelineBasisForm key={`${caseFile.timelineMode}-${coordinates.originDate}`} caseFile={caseFile} />
          <section>
            <p className="eyebrow">新增记录</p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]">
              加入事件
            </h2>
            <p className="mb-6 mt-2 text-sm leading-6 text-[var(--muted)]">
              填写日期与时刻，或选择参照事件及前后间隔。“作品中的写法”保留原文表达。
            </p>
            <EventForm
              coordinates={coordinates}
              caseId={caseId}
              eventOptions={events}
              locations={locations}
            />
          </section>

          <details className="rounded-2xl border border-[var(--line)] bg-white/55 p-5">
            <summary className="cursor-pointer list-none font-semibold marker:hidden">
              地点簿 · {locations.length}
            </summary>
            <div className="mt-5 space-y-4 border-t border-[var(--line)] pt-5">
              <LocationCreateForm caseId={caseId} locations={locations} />
              {locations.length > 0 && (
                <div className="space-y-2 border-t border-[var(--line)] pt-4">
                  {locations.map((location) => (
                    <LocationEditor
                      caseId={caseId}
                      key={location.id}
                      location={location}
                      locations={locations}
                    />
                  ))}
                </div>
              )}
            </div>
          </details>
        </div>
      }
      caseFile={caseFile}
    >
      <div className="flex flex-col gap-3 border-b border-[var(--line)] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">事件时间轴</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
            已知经过
          </h2>
        </div>
        <p className="max-w-lg text-sm leading-6 text-[var(--muted)]">
          已定位的事件在案件共同时间轴上排序；相对时间保留参照关系，范围和近似时间保留不确定性。
        </p>
      </div>

      {activeEvents.length > 0 ? (
        <div className="mt-7 space-y-10">
          <TimelineGroup
            coordinates={coordinates}
            caseId={caseId}
            eventOptions={events}
            eventTitles={eventTitles}
            events={absoluteEvents}
            label="案件共同时间轴"
            locations={locations}
            people={people}
          />
          <TimelineGroup
            coordinates={coordinates}
            caseId={caseId}
            eventOptions={events}
            eventTitles={eventTitles}
            events={relativeEvents}
            label="尚未定位的相对事件"
            locations={locations}
            people={people}
          />
          <TimelineGroup
            coordinates={coordinates}
            caseId={caseId}
            eventOptions={events}
            eventTitles={eventTitles}
            events={unknownEvents}
            label="时间未定"
            locations={locations}
            people={people}
          />
        </div>
      ) : (
        <div className="empty-dossier mt-6">
          <span className="empty-dossier-number">00</span>
          <div>
            <h3 className="text-xl font-semibold">时间轴还没有事件</h3>
            <p className="mt-2 max-w-lg leading-7 text-[var(--muted)]">
              可以先记录一个时间未定的事件，再随着调查补充时间、地点与参与人物。
            </p>
          </div>
        </div>
      )}

      {archivedEvents.length > 0 && (
        <details className="mt-10 border-t border-[var(--line)] pt-6">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--muted)]">
            已归档事件 · {archivedEvents.length}
          </summary>
          <div className="mt-5 grid gap-3">
            {archivedEvents.map((event) => (
              <article
                className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-white/40 p-4 sm:flex-row sm:items-center sm:justify-between"
                key={event.id}
              >
                <div>
                  <h3 className="font-semibold">{event.title}</h3>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {formatEventTime(event, eventTitles, coordinates)} · 修订 {event.revision}
                  </p>
                </div>
                <EventArchiveButton archived caseId={caseId} eventId={event.id} />
              </article>
            ))}
          </div>
        </details>
      )}
    </CaseWorkspaceFrame>
  );
}

function TimelineGroup({
  coordinates,
  caseId,
  eventOptions,
  eventTitles,
  events,
  label,
  locations,
  people,
}: {
  coordinates: CaseTimeCoordinates;
  caseId: string;
  eventOptions: TimelineEvent[];
  eventTitles: Map<string, string>;
  events: TimelineEvent[];
  label: string;
  locations: Array<{
    description: string;
    id: string;
    name: string;
    parentLocationId: string | null;
    sortOrder: number;
  }>;
  people: Array<{ color: string | null; displayName: string; id: string }>;
}) {
  if (events.length === 0) {
    return null;
  }

  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-[0.17em] text-[var(--accent)]">
          {label}
        </h3>
        <span className="h-px flex-1 bg-[var(--line)]" />
        <span className="text-xs text-[var(--muted)]">{events.length} 条</span>
      </div>
      <div className="timeline-list">
        {events.map((event) => (
          <TimelineCard
            coordinates={coordinates}
            caseId={caseId}
            event={event}
            eventOptions={eventOptions}
            eventTitles={eventTitles}
            key={event.id}
            locations={locations}
            people={people}
          />
        ))}
      </div>
    </section>
  );
}

function TimelineCard({
  coordinates,
  caseId,
  event,
  eventOptions,
  eventTitles,
  locations,
  people,
}: {
  coordinates: CaseTimeCoordinates;
  caseId: string;
  event: TimelineEvent;
  eventOptions: TimelineEvent[];
  eventTitles: Map<string, string>;
  locations: Array<{
    description: string;
    id: string;
    name: string;
    parentLocationId: string | null;
    sortOrder: number;
  }>;
  people: Array<{ color: string | null; displayName: string; id: string }>;
}) {
  return (
    <article className="timeline-event scroll-mt-8" id={`event-${event.id}`}>
      <span className="timeline-node" aria-hidden="true" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold tracking-[0.08em] text-[var(--accent)]">
            {formatEventTime(event, eventTitles, coordinates)}
          </p>
          <h3 className="mt-2 text-xl font-semibold tracking-[-0.025em]">
            {event.title}
          </h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="record-badge">修订 {event.revision}</span>
          {event.certainty !== null && (
            <span className="record-badge">可信度 {event.certainty}%</span>
          )}
        </div>
      </div>

      <p className="mt-4 text-[0.95rem] leading-7 text-[var(--muted)]">
        {event.description || "尚未记录事件说明。"}
      </p>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--muted)]">
        <span>地点：{event.location?.name ?? "未定"}</span>
        <span>参与：{event.participants.length} 人</span>
        <span>关联论断：{event.dependentClaimCount}</span>
        <span className="font-mono text-xs">EVENT · {event.id.slice(0, 8)}</span>
      </div>

      {event.participants.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
          {event.participants.map((participant) => (
            <span
              className="participant-chip"
              key={`${participant.personId}-${participant.role}`}
            >
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  backgroundColor: participant.person.color ?? "#9f3f2f",
                }}
              />
              {participant.person.displayName}
            </span>
          ))}
        </div>
      )}

      <details className="mt-5 border-t border-[var(--line)] pt-4">
        <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--accent)] marker:hidden">
          编辑事件与参与人物
        </summary>
        <div className="mt-5 space-y-6">
          <EventForm
              coordinates={coordinates}
            caseId={caseId}
            event={event}
            eventOptions={eventOptions}
            locations={locations}
          />
          <div className="border-t border-[var(--line)] pt-5">
            <h4 className="mb-4 font-semibold">参与人物</h4>
            <ParticipantManager
              caseId={caseId}
              eventId={event.id}
              participants={event.participants}
              people={people}
            />
          </div>
          <div className="border-t border-[var(--line)] pt-5">
            <EventArchiveButton
              archived={false}
              caseId={caseId}
              eventId={event.id}
            />
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              归档会保留修订历史，并将依赖该事件的已接受论断标记为待复核。
            </p>
          </div>
        </div>
      </details>
    </article>
  );
}

function formatEventTime(
  event: TimelineEvent,
  eventTitles: Map<string, string>,
  coordinates: CaseTimeCoordinates,
) {
  const writtenTime = event.displayTime ? `${event.displayTime} · ` : "";

  if (event.timeKind === "unknown") {
    return `${writtenTime}时间未定`;
  }
  if (event.timeKind === "relative") {
    const anchor = event.anchorEventId
      ? (eventTitles.get(event.anchorEventId) ?? "未知事件")
      : "未知事件";
    return `${writtenTime}${anchor} ${formatSignedSeconds(event.relativeOffsetSeconds ?? 0)} · ${event.resolvedTime.status === "located" ? "推算：" : ""}${formatResolvedTime(event.resolvedTime, coordinates.calendar ? coordinates.originDate : "", coordinates.originLabel)}`;
  }
  if (event.timeKind === "range") {
    return `${writtenTime}${formatResolvedTime(event.resolvedTime, coordinates.calendar ? coordinates.originDate : "", coordinates.originLabel)}`;
  }

  return `${writtenTime}${formatResolvedTime(event.resolvedTime, coordinates.calendar ? coordinates.originDate : "", coordinates.originLabel)}`;
}

function formatSignedSeconds(value: number) {
  if (value === 0) return "同一时刻";
  const absolute = Math.abs(value);
  const hours = Math.floor(absolute / 3_600);
  const minutes = Math.floor((absolute % 3_600) / 60);
  const seconds = absolute % 60;

  const interval = [hours ? `${hours} 小时` : "", minutes ? `${minutes} 分钟` : "", seconds ? `${seconds} 秒` : ""].filter(Boolean).join(" ");
  return `${value < 0 ? "之前" : "之后"} ${interval}`;
}
