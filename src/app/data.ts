import "server-only";

import { connection } from "next/server";

import { databaseConnection } from "@/db/client";
import { CaseRepository } from "@/db/repositories/case-repository";

const caseRepository = new CaseRepository(databaseConnection);

export async function getCaseDashboard() {
  await connection();
  return caseRepository.listCases();
}

export async function getCaseWorkspace(caseId: string) {
  await connection();

  return {
    caseFile: caseRepository.getCaseSummary(caseId),
    people: caseRepository.listPeople(caseId),
  };
}
