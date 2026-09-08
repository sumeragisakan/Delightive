"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { ActionState } from "./action-state";
import { databaseConnection } from "@/db/client";
import { CaseRepository } from "@/db/repositories/case-repository";
import { EvidenceRepository } from "@/db/repositories/evidence-repository";
import { EventRepository } from "@/db/repositories/event-repository";
import { LocationRepository } from "@/db/repositories/location-repository";
import { ReasoningWorkspaceRepository } from "@/db/repositories/reasoning-workspace-repository";
import type {
  ClaimEntityRole,
  SourceRelationKind,
} from "@/db/schema";

const caseRepository = new CaseRepository(databaseConnection);
const evidenceRepository = new EvidenceRepository(databaseConnection);
const eventRepository = new EventRepository(databaseConnection);
const locationRepository = new LocationRepository(databaseConnection);
const reasoningWorkspaceRepository = new ReasoningWorkspaceRepository(
  databaseConnection,
);

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

const sourceKindSchema = z.enum(
  ["narration", "chapter", "statement", "document", "image", "user", "other"],
  { error: "请选择有效的来源类型。" },
);
const sourceRelationSchema = z.enum(["origin", "supports", "contradicts"], {
  error: "请选择有效的来源关系。",
});
const claimEntityRoleSchema = z.enum(
  ["subject", "object", "speaker", "context", "mentioned"],
  { error: "请选择有效的关联角色。" },
);
const evidenceStatusSchema = z.enum(
  ["draft", "accepted", "rejected", "needs_review", "superseded"],
  { error: "请选择有效的事实状态。" },
);

const sourceSchema = z.object({
  excerpt: z
    .string()
    .trim()
    .max(8_000, "来源摘录不能超过 8000 个字符。")
    .transform((value) => value || null),
  kind: sourceKindSchema,
  locator: z
    .string()
    .trim()
    .max(300, "来源定位不能超过 300 个字符。")
    .transform((value) => value || null),
  notes: z.string().trim().max(4_000, "来源备注不能超过 4000 个字符。"),
  title: z
    .string()
    .trim()
    .min(1, "请输入来源标题。")
    .max(160, "来源标题不能超过 160 个字符。"),
});

const evidenceClaimSchema = z
  .object({
    confidence: optionalPercentageSchema,
    content: z
      .string()
      .trim()
      .min(1, "请输入事实或陈述内容。")
      .max(8_000, "内容不能超过 8000 个字符。"),
    eventId: optionalIdSchema,
    eventRole: claimEntityRoleSchema,
    kind: z.enum(["fact", "statement"], {
      error: "请选择事实或人物陈述。",
    }),
    locationId: optionalIdSchema,
    locationRole: claimEntityRoleSchema,
    personId: optionalIdSchema,
    personRole: claimEntityRoleSchema,
    sourceId: optionalIdSchema,
    sourceRelation: sourceRelationSchema,
    speakerPersonId: optionalIdSchema,
    status: evidenceStatusSchema,
  })
  .superRefine((claim, context) => {
    if (
      claim.status === "accepted" &&
      (!claim.sourceId || claim.sourceRelation === "contradicts")
    ) {
      context.addIssue({
        code: "custom",
        message: "确认事实前，请关联一条原始或支持来源。",
        path: ["sourceId"],
      });
    }
    if (claim.kind === "fact" && claim.speakerPersonId) {
      context.addIssue({
        code: "custom",
        message: "只有人物陈述可以指定发言者。",
        path: ["speakerPersonId"],
      });
    }
  });

const evidenceClaimUpdateSchema = z.object({
  confidence: optionalPercentageSchema,
  content: z
    .string()
    .trim()
    .min(1, "请输入事实或陈述内容。")
    .max(8_000, "内容不能超过 8000 个字符。"),
  speakerPersonId: optionalIdSchema,
  status: evidenceStatusSchema,
});

const sourceLinkSchema = z.object({
  relation: sourceRelationSchema,
  sourceId: z.string().trim().min(1, "请选择来源。"),
});

const entityLinkSchema = z.object({
  entityId: z.string().trim().min(1, "请选择关联对象。"),
  role: claimEntityRoleSchema,
});

const branchSchema = z.object({
  description: z.string().trim().max(2_000, "分支说明不能超过 2000 个字符。"),
  name: z
    .string()
    .trim()
    .min(1, "请输入分支名称。")
    .max(120, "分支名称不能超过 120 个字符。"),
  parentBranchId: optionalIdSchema,
});

const reasoningClaimSchema = z.object({
  confidence: optionalPercentageSchema,
  content: z
    .string()
    .trim()
    .min(1, "请输入假设内容。")
    .max(8_000, "假设内容不能超过 8000 个字符。"),
});

const argumentSchema = z.object({
  premiseClaimId: z.string().trim().min(1, "请选择一条前提。"),
  rationale: z.string().trim().max(2_000, "关系说明不能超过 2000 个字符。"),
  relation: z.enum(["supports", "contradicts", "depends_on", "qualifies"], {
    error: "请选择有效的论证关系。",
  }),
  strength: optionalPercentageSchema,
});

const reviewSchema = z.object({
  note: z.string().trim().max(2_000, "审查说明不能超过 2000 个字符。"),
});

const conflictReviewSchema = reviewSchema.extend({
  decision: z.enum(
    [
      "retained",
      "prefer_premise",
      "prefer_conclusion",
      "both_review",
      "dismissed",
    ],
    { error: "请选择有效的冲突处置。" },
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

export async function createSourceAction(
  caseId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = sourceSchema.safeParse(readSourceForm(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查来源信息。");
  }

  try {
    evidenceRepository.createSource({ caseId, ...parsed.data });
  } catch (error) {
    return persistenceFailure(error, "无法添加来源。");
  }

  revalidateCase(caseId);
  return { message: "来源已加入案件。", status: "success" };
}

export async function updateSourceAction(
  caseId: string,
  sourceId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = sourceSchema.safeParse(readSourceForm(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查来源信息。");
  }

  try {
    evidenceRepository.updateSource(caseId, sourceId, parsed.data);
  } catch (error) {
    return persistenceFailure(error, "无法保存来源。");
  }

  revalidateCase(caseId);
  return {
    message: "来源已保存；依赖它的内容会在需要时标记为待复核。",
    status: "success",
  };
}

export async function setSourceArchivedAction(
  caseId: string,
  sourceId: string,
  archived: boolean,
) {
  evidenceRepository.setSourceArchived(caseId, sourceId, archived);
  revalidateCase(caseId);
}

export async function createEvidenceClaimAction(
  caseId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = evidenceClaimSchema.safeParse(readEvidenceClaimForm(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查事实信息。");
  }

  try {
    evidenceRepository.createEvidenceClaim({ caseId, ...parsed.data });
  } catch (error) {
    return persistenceFailure(error, "无法添加事实；请检查来源和关联对象。");
  }

  revalidateCase(caseId);
  return { message: "内容已加入事实层。", status: "success" };
}

export async function updateEvidenceClaimAction(
  caseId: string,
  claimId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = evidenceClaimUpdateSchema.safeParse({
    confidence: readText(formData, "confidence"),
    content: readText(formData, "content"),
    speakerPersonId: readText(formData, "speakerPersonId"),
    status: readText(formData, "status"),
  });

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查事实信息。");
  }

  try {
    evidenceRepository.updateEvidenceClaim(caseId, claimId, parsed.data);
  } catch (error) {
    return persistenceFailure(
      error,
      "无法保存；已确认内容必须保留至少一条有效来源。",
    );
  }

  revalidateCase(caseId);
  return {
    message: "内容已保存；下游推理会在需要时标记为待复核。",
    status: "success",
  };
}

export async function setEvidenceClaimArchivedAction(
  caseId: string,
  claimId: string,
  archived: boolean,
) {
  evidenceRepository.setClaimArchived(caseId, claimId, archived);
  revalidateCase(caseId);
}

export async function addClaimSourceAction(
  caseId: string,
  claimId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = sourceLinkSchema.safeParse({
    relation: readText(formData, "relation"),
    sourceId: readText(formData, "sourceId"),
  });

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查来源关联。");
  }

  try {
    evidenceRepository.addSourceLink({ caseId, claimId, ...parsed.data });
  } catch (error) {
    const fallback =
      error instanceof Error && error.message.includes("UNIQUE constraint")
        ? "这条来源关系已经存在。"
        : "无法关联来源。";
    return persistenceFailure(error, fallback);
  }

  revalidateCase(caseId);
  return { message: "来源已关联。", status: "success" };
}

export async function removeClaimSourceAction(
  caseId: string,
  claimId: string,
  sourceId: string,
  relation: SourceRelationKind,
) {
  evidenceRepository.removeSourceLink({
    caseId,
    claimId,
    relation,
    sourceId,
  });
  revalidateCase(caseId);
}

export async function addClaimEventAction(
  caseId: string,
  claimId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = entityLinkSchema.safeParse({
    entityId: readText(formData, "entityId"),
    role: readText(formData, "role"),
  });

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查事件关联。");
  }

  try {
    evidenceRepository.addEventLink({
      caseId,
      claimId,
      eventId: parsed.data.entityId,
      role: parsed.data.role,
    });
  } catch (error) {
    return linkFailure(error, "事件");
  }

  revalidateCase(caseId);
  return { message: "事件已关联。", status: "success" };
}

export async function removeClaimEventAction(
  caseId: string,
  claimId: string,
  eventId: string,
  role: ClaimEntityRole,
) {
  evidenceRepository.removeEventLink({ caseId, claimId, eventId, role });
  revalidateCase(caseId);
}

export async function addClaimPersonAction(
  caseId: string,
  claimId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = entityLinkSchema.safeParse({
    entityId: readText(formData, "entityId"),
    role: readText(formData, "role"),
  });

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查人物关联。");
  }

  try {
    evidenceRepository.addPersonLink({
      caseId,
      claimId,
      personId: parsed.data.entityId,
      role: parsed.data.role,
    });
  } catch (error) {
    return linkFailure(error, "人物");
  }

  revalidateCase(caseId);
  return { message: "人物已关联。", status: "success" };
}

export async function removeClaimPersonAction(
  caseId: string,
  claimId: string,
  personId: string,
  role: ClaimEntityRole,
) {
  evidenceRepository.removePersonLink({ caseId, claimId, personId, role });
  revalidateCase(caseId);
}

export async function addClaimLocationAction(
  caseId: string,
  claimId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = entityLinkSchema.safeParse({
    entityId: readText(formData, "entityId"),
    role: readText(formData, "role"),
  });

  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查地点关联。");
  }

  try {
    evidenceRepository.addLocationLink({
      caseId,
      claimId,
      locationId: parsed.data.entityId,
      role: parsed.data.role,
    });
  } catch (error) {
    return linkFailure(error, "地点");
  }

  revalidateCase(caseId);
  return { message: "地点已关联。", status: "success" };
}

export async function removeClaimLocationAction(
  caseId: string,
  claimId: string,
  locationId: string,
  role: ClaimEntityRole,
) {
  evidenceRepository.removeLocationLink({ caseId, claimId, locationId, role });
  revalidateCase(caseId);
}

export async function createReasoningBranchAction(
  caseId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = branchSchema.safeParse(readBranchForm(formData));
  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查分支信息。");
  }

  try {
    reasoningWorkspaceRepository.createBranch({ caseId, ...parsed.data });
  } catch (error) {
    return reasoningFailure(error, "无法创建推理分支；请检查名称和上级分支。");
  }
  revalidateCase(caseId);
  return { message: "推理分支已创建。", status: "success" };
}

export async function updateReasoningBranchAction(
  caseId: string,
  branchId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = branchSchema.safeParse(readBranchForm(formData));
  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查分支信息。");
  }

  try {
    reasoningWorkspaceRepository.updateBranch(caseId, branchId, parsed.data);
  } catch (error) {
    return reasoningFailure(error, "无法保存分支；请检查名称和层级。");
  }
  revalidateCase(caseId);
  return { message: "分支信息已保存。", status: "success" };
}

export async function setReasoningBranchArchivedAction(
  caseId: string,
  branchId: string,
  archived: boolean,
  _previousState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  void _previousState;
  void _formData;
  try {
    reasoningWorkspaceRepository.setBranchArchived(caseId, branchId, archived);
  } catch (error) {
    return reasoningFailure(error, "无法变更分支状态；请先处理活动子分支。");
  }
  revalidateCase(caseId);
  return {
    message: archived ? "分支已归档。" : "分支已恢复。",
    status: "success",
  };
}

export async function createHypothesisAction(
  caseId: string,
  branchId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = reasoningClaimSchema.safeParse(readReasoningClaimForm(formData));
  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查假设内容。");
  }

  try {
    reasoningWorkspaceRepository.createHypothesis({
      branchId,
      caseId,
      ...parsed.data,
    });
  } catch (error) {
    return reasoningFailure(error, "无法添加假设。");
  }
  revalidateCase(caseId);
  return { message: "假设已加入当前分支。", status: "success" };
}

export async function updateReasoningClaimAction(
  caseId: string,
  claimId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = reasoningClaimSchema.safeParse(readReasoningClaimForm(formData));
  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查推理内容。");
  }

  try {
    reasoningWorkspaceRepository.reviseReasoningClaim(caseId, claimId, parsed.data);
  } catch (error) {
    return reasoningFailure(error, "无法保存推理内容。");
  }
  revalidateCase(caseId);
  return {
    message: "推理内容已保存；原可信推论会转入待复核。",
    status: "success",
  };
}

export async function addReasoningArgumentAction(
  caseId: string,
  conclusionClaimId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = argumentSchema.safeParse({
    premiseClaimId: readText(formData, "premiseClaimId"),
    rationale: readText(formData, "rationale"),
    relation: readText(formData, "relation"),
    strength: readText(formData, "strength"),
  });
  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查论证关系。");
  }

  try {
    reasoningWorkspaceRepository.addArgument({
      caseId,
      conclusionClaimId,
      ...parsed.data,
    });
  } catch (error) {
    return reasoningFailure(error, "无法添加论证关系。");
  }
  revalidateCase(caseId);
  return { message: "论证关系已添加。", status: "success" };
}

export async function removeReasoningArgumentAction(
  caseId: string,
  linkId: string,
  _previousState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  void _previousState;
  void _formData;
  try {
    reasoningWorkspaceRepository.removeArgument(caseId, linkId);
  } catch (error) {
    return reasoningFailure(error, "无法移除论证关系。");
  }
  revalidateCase(caseId);
  return { message: "论证关系已移除。", status: "success" };
}

export async function promoteHypothesisAction(
  caseId: string,
  claimId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = reviewSchema.safeParse({ note: readText(formData, "note") });
  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查审查说明。");
  }
  try {
    reasoningWorkspaceRepository.promoteHypothesis(
      caseId,
      claimId,
      parsed.data.note,
    );
  } catch (error) {
    return reasoningFailure(error, "当前假设尚未满足晋升条件。");
  }
  revalidateCase(caseId);
  return { message: "假设已晋升为可信推论。", status: "success" };
}

export async function reconfirmInferenceAction(
  caseId: string,
  claimId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = reviewSchema.safeParse({ note: readText(formData, "note") });
  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查复核说明。");
  }
  try {
    reasoningWorkspaceRepository.reconfirmInference(
      caseId,
      claimId,
      parsed.data.note,
    );
  } catch (error) {
    return reasoningFailure(error, "这条推论目前无法重新接受。");
  }
  revalidateCase(caseId);
  return { message: "推论已按当前前提重新确认。", status: "success" };
}

export async function demoteInferenceAction(
  caseId: string,
  claimId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = reviewSchema.safeParse({ note: readText(formData, "note") });
  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查复核说明。");
  }
  try {
    reasoningWorkspaceRepository.demoteInference(caseId, claimId, parsed.data.note);
  } catch (error) {
    return reasoningFailure(error, "无法将这条推论转入待复核。");
  }
  revalidateCase(caseId);
  return { message: "推论已转入待复核。", status: "success" };
}

export async function rejectReasoningClaimAction(
  caseId: string,
  claimId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = reviewSchema.safeParse({ note: readText(formData, "note") });
  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查否定说明。");
  }
  try {
    reasoningWorkspaceRepository.rejectReasoningClaim(
      caseId,
      claimId,
      parsed.data.note,
    );
  } catch (error) {
    return reasoningFailure(error, "无法否定这条推理。");
  }
  revalidateCase(caseId);
  return { message: "这条推理已标记为否定。", status: "success" };
}

export async function reviewReasoningConflictAction(
  caseId: string,
  linkId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = conflictReviewSchema.safeParse({
    decision: readText(formData, "decision"),
    note: readText(formData, "note"),
  });
  if (!parsed.success) {
    return validationFailure(parsed.error, "请检查冲突处置。");
  }
  try {
    reasoningWorkspaceRepository.reviewConflict({
      caseId,
      linkId,
      ...parsed.data,
    });
  } catch (error) {
    return reasoningFailure(error, "无法记录冲突处置。");
  }
  revalidateCase(caseId);
  return { message: "冲突处置已记录。", status: "success" };
}

function readCaseForm(formData: FormData) {
  return {
    description: readText(formData, "description"),
    timelineMode: readText(formData, "timelineMode"),
    title: readText(formData, "title"),
  };
}

function readBranchForm(formData: FormData) {
  return {
    description: readText(formData, "description"),
    name: readText(formData, "name"),
    parentBranchId: readText(formData, "parentBranchId"),
  };
}

function readReasoningClaimForm(formData: FormData) {
  return {
    confidence: readText(formData, "confidence"),
    content: readText(formData, "content"),
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

function readSourceForm(formData: FormData) {
  return {
    excerpt: readText(formData, "excerpt"),
    kind: readText(formData, "kind"),
    locator: readText(formData, "locator"),
    notes: readText(formData, "notes"),
    title: readText(formData, "title"),
  };
}

function readEvidenceClaimForm(formData: FormData) {
  return {
    confidence: readText(formData, "confidence"),
    content: readText(formData, "content"),
    eventId: readText(formData, "eventId"),
    eventRole: readText(formData, "eventRole"),
    kind: readText(formData, "kind"),
    locationId: readText(formData, "locationId"),
    locationRole: readText(formData, "locationRole"),
    personId: readText(formData, "personId"),
    personRole: readText(formData, "personRole"),
    sourceId: readText(formData, "sourceId"),
    sourceRelation: readText(formData, "sourceRelation"),
    speakerPersonId: readText(formData, "speakerPersonId"),
    status: readText(formData, "status"),
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

function reasoningFailure(error: unknown, fallback: string): ActionState {
  const safeMessage =
    error instanceof Error && /[\u3400-\u9fff]/u.test(error.message)
      ? error.message
      : fallback;
  return persistenceFailure(error, safeMessage);
}

function linkFailure(error: unknown, label: string): ActionState {
  const fallback =
    error instanceof Error && error.message.includes("UNIQUE constraint")
      ? `这条${label}关系已经存在。`
      : `无法关联${label}。`;
  return persistenceFailure(error, fallback);
}

function revalidateCase(caseId: string) {
  revalidatePath("/");
  revalidatePath(`/cases/${caseId}`);
  revalidatePath(`/cases/${caseId}/timeline`);
  revalidatePath(`/cases/${caseId}/evidence`);
  revalidatePath(`/cases/${caseId}/reasoning`);
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
