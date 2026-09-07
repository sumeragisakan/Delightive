"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { ActionState } from "./action-state";
import { databaseConnection } from "@/db/client";
import { CaseRepository } from "@/db/repositories/case-repository";

const caseRepository = new CaseRepository(databaseConnection);

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
}
