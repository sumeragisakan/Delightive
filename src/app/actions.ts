"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { ActionState } from "./action-state";
import { databaseConnection } from "@/db/client";
import { CaseRepository } from "@/db/repositories/case-repository";
import { EventRepository } from "@/db/repositories/event-repository";
import { LocationRepository } from "@/db/repositories/location-repository";

const caseRepository = new CaseRepository(databaseConnection);
const eventRepository = new EventRepository(databaseConnection);
const locationRepository = new LocationRepository(databaseConnection);

const caseSchema = z.object({
  description: z.string().trim().max(2_000, "案件说明不能超过 2000 个字符。"),
  timelineMode: z.enum(["relative", "calendar", "ordinal"], {
    error: "请选择有效的时间轴类型。",
  }),
  title: z
    .string()
    .trim()
    .min(1, "请输入案件名称。")
    .max(120, "案件名称不能超过 120 个字符。"),
});

const personSchema = z.object({
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-f]{6}$/i, "请选择有效的识别颜色。"),
  description: z.string().trim().max(2_000, "人物说明不能超过 2000 个字符。"),
  displayName: z
    .string()
    .trim()
    .min(1, "请输入人物称呼。")
    .max(120, "人物称呼不能超过 120 个字符。"),
});

const aliasSchema = z.object({
  alias: z
    .string()
    .trim()
    .min(1, "请输入别名。")
    .max(120, "别名不能超过 120 个字符。"),
  kind: z.enum(["name", "code", "description", "unknown"], {
    error: "请选择有效的别名类型。",
  }),
});

const optionalIdSchema = z
  .string()
  .trim()
  .transform((value) => value || null);
const offsetSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || parseDuration(value) !== null,
    "请使用 时:分:秒，例如 01:20:30 或 -00:05:00。",
  )
  .transform((value) => (value === "" ? null : parseDuration(value)));
const optionalPercentageSchema = z
  .string()
  .trim()
  .refine(
    (value) =>
      value === "" ||
      (Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 100),
    "请输入 0 到 100 之间的整数。",
  )
  .transform((value) => (value === "" ? null : Number(value)));
const sortOrderSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || Number.isInteger(Number(value)),
    "顺序必须是整数。",
  )
  .transform((value) => (value === "" ? 0 : Number(value)));

const locationSchema = z.object({
  description: z.string().trim().max(2_000, "地点说明不能超过 2000 个字符。"),
  name: z
    .string()
    .trim()
    .min(1, "请输入地点名称。")
    .max(120, "地点名称不能超过 120 个字符。"),
  parentLocationId: optionalIdSchema,
  sortOrder: sortOrderSchema,
});

const eventSchema = z
  .object({
    anchorEventId: optionalIdSchema,
    certainty: optionalPercentageSchema,
    description: z.string().trim().max(4_000, "事件说明不能超过 4000 个字符。"),
    displayTime: z
      .string()
      .trim()
      .max(120, "显示时间不能超过 120 个字符。")
      .transform((value) => value || null),
    endOffsetSeconds: offsetSchema,
    locationId: optionalIdSchema,
    relativeOffsetSeconds: offsetSchema,
    sortOrder: sortOrderSchema,
    startOffsetSeconds: offsetSchema,
    timeKind: z.enum(
      ["exact", "range", "approximate", "relative", "unknown"],
      { error: "请选择有效的时间类型。" },
    ),
    title: z
      .string()
      .trim()
      .min(1, "请输入事件标题。")
      .max(160, "事件标题不能超过 160 个字符。"),
  })
  .superRefine((event, context) => {
    if (
      ["exact", "range", "approximate"].includes(event.timeKind) &&
      event.startOffsetSeconds === null
    ) {
      context.addIssue({
        code: "custom",
        message: "请输入事件起点。",
        path: ["startOffsetSeconds"],
      });
    }
    if (event.timeKind === "range" && event.endOffsetSeconds === null) {
      context.addIssue({
        code: "custom",
        message: "请输入事件终点。",
        path: ["endOffsetSeconds"],
      });
    }
    if (
      event.timeKind === "range" &&
      event.startOffsetSeconds !== null &&
      event.endOffsetSeconds !== null &&
      event.endOffsetSeconds < event.startOffsetSeconds
    ) {
      context.addIssue({
        code: "custom",
        message: "事件终点不能早于起点。",
        path: ["endOffsetSeconds"],
      });
    }
    if (event.timeKind === "relative" && !event.anchorEventId) {
      context.addIssue({
        code: "custom",
        message: "请选择参照事件。",
        path: ["anchorEventId"],
      });
    }
    if (
      event.timeKind === "relative" &&
      event.relativeOffsetSeconds === null
    ) {
      context.addIssue({
        code: "custom",
        message: "请输入相对偏移。",
        path: ["relativeOffsetSeconds"],
      });
    }
  });

const participantSchema = z.object({
  notes: z.string().trim().max(1_000, "参与说明不能超过 1000 个字符。"),
  personId: z.string().trim().min(1, "请选择人物。"),
  presence: z.enum(["confirmed", "claimed", "possible", "denied"], {
    error: "请选择有效的在场状态。",
  }),
  role: z.enum(
    ["actor", "witness", "victim", "present", "mentioned", "other"],
    { error: "请选择有效的参与角色。" },
  ),
});

export async function createCaseAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = caseSchema.safeParse(readCaseForm(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查案件信息。 ");
  }

  let caseId: string;

  try {
    caseId = caseRepository.createCase(parsed.data).id;
  } catch (error) {
    return persistenceFailure(error, "无法创建案件，请稍后重试。");
  }

  revalidatePath("/");
  redirect(`/cases/${caseId}`);
}

export async function createCaseFromToolAction(input: unknown): Promise<
  | { id: string; ok: true; title: string; url: string }
  | { message: string; ok: false }
> {
  const parsed = caseSchema.safeParse(input);

  if (!parsed.success) {
    return { message: "案件信息无效。", ok: false };
  }

  try {
    const created = caseRepository.createCase(parsed.data);
    revalidatePath("/");
    return {
      id: created.id,
      ok: true,
      title: created.title,
      url: `/cases/${created.id}`,
    };
  } catch (error) {
    console.error(error);
    return { message: "无法创建案件。", ok: false };
  }
}

export async function updateCaseAction(
  caseId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = caseSchema.safeParse(readCaseForm(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查案件信息。");
  }

  try {
    caseRepository.updateCase(caseId, parsed.data);
  } catch (error) {
    return persistenceFailure(error, "无法保存案件信息。");
  }

  revalidateCase(caseId);
  return { message: "案件信息已保存。", status: "success" };
}

export async function setCaseStatusAction(
  caseId: string,
  status: "active" | "archived",
) {
  caseRepository.setCaseStatus(caseId, status);
  revalidateCase(caseId);

  if (status === "archived") {
    redirect("/");
  }
}

export async function createPersonAction(
  caseId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = personSchema.safeParse(readPersonForm(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查人物信息。");
  }

  try {
    caseRepository.createPerson({ caseId, ...parsed.data });
  } catch (error) {
    return persistenceFailure(error, "无法添加人物。");
  }

  revalidateCase(caseId);
  return { message: "人物已加入案件。", status: "success" };
}

export async function updatePersonAction(
  caseId: string,
  personId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = personSchema.safeParse(readPersonForm(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查人物信息。");
  }

  try {
    caseRepository.updatePerson(caseId, personId, parsed.data);
  } catch (error) {
    return persistenceFailure(error, "无法保存人物信息。");
  }

  revalidateCase(caseId);
  return { message: "人物信息已保存。", status: "success" };
}

export async function deletePersonAction(caseId: string, personId: string) {
  caseRepository.deletePerson(caseId, personId);
  revalidateCase(caseId);
}

export async function addPersonAliasAction(
  caseId: string,
  personId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = aliasSchema.safeParse({
    alias: readText(formData, "alias"),
    kind: readText(formData, "kind"),
  });

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查别名信息。");
  }

  try {
    caseRepository.addPersonAlias({ personId, ...parsed.data });
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("UNIQUE constraint")
        ? "该人物已经使用过这个别名。"
        : "无法添加别名。";
    return persistenceFailure(error, message);
  }

  revalidateCase(caseId);
  return { message: "别名已添加。", status: "success" };
}

export async function removePersonAliasAction(
  caseId: string,
  aliasId: string,
) {
  caseRepository.removePersonAlias(caseId, aliasId);
  revalidateCase(caseId);
}

export async function createLocationAction(
  caseId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = locationSchema.safeParse(readLocationForm(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查地点信息。");
  }

  try {
    locationRepository.createLocation({ caseId, ...parsed.data });
  } catch (error) {
    return persistenceFailure(error, "无法添加地点。");
  }

  revalidateCase(caseId);
  return { message: "地点已加入案件。", status: "success" };
}

export async function updateLocationAction(
  caseId: string,
  locationId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = locationSchema.safeParse(readLocationForm(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查地点信息。");
  }

  try {
    locationRepository.updateLocation(caseId, locationId, parsed.data);
  } catch (error) {
    return persistenceFailure(error, "无法保存地点；请检查上级地点设置。");
  }

  revalidateCase(caseId);
  return { message: "地点信息已保存。", status: "success" };
}

export async function createEventAction(
  caseId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = eventSchema.safeParse(readEventForm(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查事件信息。");
  }

  try {
    eventRepository.createEvent({ caseId, ...parsed.data });
  } catch (error) {
    return persistenceFailure(error, "无法添加事件；请检查时间与关联项。");
  }

  revalidateCase(caseId);
  return { message: "事件已加入时间轴。", status: "success" };
}

export async function updateEventAction(
  caseId: string,
  eventId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = eventSchema.safeParse(readEventForm(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查事件信息。");
  }

  try {
    eventRepository.updateEvent(caseId, eventId, parsed.data);
  } catch (error) {
    return persistenceFailure(error, "无法保存事件；请检查时间与关联项。");
  }

  revalidateCase(caseId);
  return {
    message: "事件已保存；相关推理会在需要时标记为待复核。",
    status: "success",
  };
}

export async function setEventArchivedAction(
  caseId: string,
  eventId: string,
  archived: boolean,
) {
  eventRepository.setEventArchived(caseId, eventId, archived);
  revalidateCase(caseId);
}

export async function addEventParticipantAction(
  caseId: string,
  eventId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = participantSchema.safeParse(readParticipantForm(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查参与人物信息。");
  }

  try {
    eventRepository.addParticipant({ eventId, ...parsed.data });
  } catch (error) {
    const fallback =
      error instanceof Error && error.message.includes("UNIQUE constraint")
        ? "这个人物已用相同角色加入事件。"
        : "无法添加参与人物。";
    return persistenceFailure(error, fallback);
  }

  revalidateCase(caseId);
  return { message: "参与人物已添加。", status: "success" };
}

export async function updateEventParticipantAction(
  caseId: string,
  eventId: string,
  personId: string,
  role: "actor" | "witness" | "victim" | "present" | "mentioned" | "other",
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = participantSchema.safeParse({
    ...readParticipantForm(formData),
    personId,
    role,
  });

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查参与人物信息。");
  }

  try {
    eventRepository.updateParticipant({ eventId, ...parsed.data });
  } catch (error) {
    return persistenceFailure(error, "无法保存参与人物信息。");
  }

  revalidateCase(caseId);
  return { message: "参与信息已保存。", status: "success" };
}

export async function removeEventParticipantAction(
  caseId: string,
  eventId: string,
  personId: string,
  role: "actor" | "witness" | "victim" | "present" | "mentioned" | "other",
) {
  eventRepository.removeParticipant({ eventId, personId, role });
  revalidateCase(caseId);
}

function readCaseForm(formData: FormData) {
  return {
    description: readText(formData, "description"),
    timelineMode: readText(formData, "timelineMode"),
    title: readText(formData, "title"),
  };
}

function readPersonForm(formData: FormData) {
  return {
    color: readText(formData, "color"),
    description: readText(formData, "description"),
    displayName: readText(formData, "displayName"),
  };
}

function readLocationForm(formData: FormData) {
  return {
    description: readText(formData, "description"),
    name: readText(formData, "name"),
    parentLocationId: readText(formData, "parentLocationId"),
    sortOrder: readText(formData, "sortOrder"),
  };
}

function readEventForm(formData: FormData) {
  return {
    anchorEventId: readText(formData, "anchorEventId"),
    certainty: readText(formData, "certainty"),
    description: readText(formData, "description"),
    displayTime: readText(formData, "displayTime"),
    endOffsetSeconds: readText(formData, "endOffsetSeconds"),
    locationId: readText(formData, "locationId"),
    relativeOffsetSeconds: readText(formData, "relativeOffsetSeconds"),
    sortOrder: readText(formData, "sortOrder"),
    startOffsetSeconds: readText(formData, "startOffsetSeconds"),
    timeKind: readText(formData, "timeKind"),
    title: readText(formData, "title"),
  };
}

function readParticipantForm(formData: FormData) {
  return {
    notes: readText(formData, "notes"),
    personId: readText(formData, "personId"),
    presence: readText(formData, "presence"),
    role: readText(formData, "role"),
  };
}

function readText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function validationFailure(
  error: z.ZodError,
  message: string,
): ActionState {
  return {
    fieldErrors: z.flattenError(error).fieldErrors,
    message,
    status: "error",
  };
}

function persistenceFailure(error: unknown, fallback: string): ActionState {
  console.error(error);
  return { message: fallback, status: "error" };
}

function revalidateCase(caseId: string) {
  revalidatePath("/");
  revalidatePath(`/cases/${caseId}`);
  revalidatePath(`/cases/${caseId}/timeline`);
}

function parseDuration(value: string) {
  const match = /^([+-])?(\d+):([0-5]\d):([0-5]\d)$/.exec(value.trim());

  if (!match) {
    return null;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const seconds =
    sign *
    (Number(match[2]) * 3_600 +
      Number(match[3]) * 60 +
      Number(match[4]));

  return Number.isSafeInteger(seconds) ? seconds : null;
}
