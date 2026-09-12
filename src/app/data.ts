import "server-only";

import { connection } from "next/server";

import { databaseConnection } from "@/db/client";
import { CaseRepository } from "@/db/repositories/case-repository";
import { EvidenceRepository } from "@/db/repositories/evidence-repository";
import { EventRepository } from "@/db/repositories/event-repository";
import { LocationRepository } from "@/db/repositories/location-repository";
import { InvestigationRepository } from "@/db/repositories/investigation-repository";
import { ReasoningWorkspaceRepository } from "@/db/repositories/reasoning-workspace-repository";
import { AiReasoningService } from "@/db/services/ai-reasoning-service";
import { AiRunComparisonService } from "@/db/services/ai-run-comparison-service";
import { AiSettingsService } from "@/db/services/ai-settings-service";
import { buildReasoningContext } from "@/db/services/reasoning-context-service";
import {
  parseSearchFilters,
  SearchService,
} from "@/db/services/search-service";

const caseRepository = new CaseRepository(databaseConnection);
const evidenceRepository = new EvidenceRepository(databaseConnection);
const eventRepository = new EventRepository(databaseConnection);
const locationRepository = new LocationRepository(databaseConnection);
const investigationRepository = new InvestigationRepository(databaseConnection);
const reasoningWorkspaceRepository = new ReasoningWorkspaceRepository(
  databaseConnection,
);
const aiSettingsService = new AiSettingsService(databaseConnection);
const searchService = new SearchService(databaseConnection);

export async function getCaseDashboard() {
  await connection();
  return caseRepository.listCases();
}

export async function getSearchWorkspace(
  parameters: Record<string, string | string[] | undefined>,
) {
  await connection();
  const filters = parseSearchFilters(parameters);
  const results = searchService.search(filters);
  return {
    branches: searchService.listBranches(filters.caseId),
    cases: caseRepository.listCases(),
    results,
  };
}

export async function getCaseWorkspace(caseId: string) {
  await connection();

  return {
    caseFile: caseRepository.getCaseSummary(caseId),
    people: caseRepository.listPeople(caseId),
  };
}

export async function getTimelineWorkspace(caseId: string) {
  await connection();

  return {
    caseFile: caseRepository.getCaseSummary(caseId),
    events: eventRepository.listTimeline(caseId),
    locations: locationRepository.listLocations(caseId),
    people: caseRepository.listPeople(caseId),
  };
}

export async function getEvidenceWorkspace(caseId: string) {
  await connection();

  return {
    caseFile: caseRepository.getCaseSummary(caseId),
    claims: evidenceRepository.listEvidenceClaims(caseId),
    events: eventRepository.listTimeline(caseId, false),
    locations: locationRepository.listLocations(caseId),
    people: caseRepository.listPeople(caseId),
    sources: evidenceRepository.listSources(caseId),
  };
}

export async function getReasoningWorkspace(
  caseId: string,
  branchId?: string | null,
) {
  await connection();
  const caseFile = caseRepository.getCaseSummary(caseId);

  if (!caseFile) {
    return { caseFile, workspace: null };
  }

  return {
    caseFile,
    workspace: reasoningWorkspaceRepository.getWorkspace(caseId, branchId),
  };
}

export async function getAiReasoningWorkspace(
  caseId: string,
  branchId?: string | null,
) {
  await connection();
  const caseFile = caseRepository.getCaseSummary(caseId);
  if (!caseFile) {
    return {
      caseFile,
      configuration: aiSettingsService.getSettings(),
      context: null,
      investigationItems: [],
      runs: [],
      workspace: null,
    };
  }
  const workspace = reasoningWorkspaceRepository.getWorkspace(caseId, branchId);
  const selectedBranchId = workspace.selectedBranch?.id;
  return {
    caseFile,
    configuration: aiSettingsService.getSettings(),
    context: selectedBranchId
      ? buildReasoningContext(databaseConnection, caseId, selectedBranchId)
      : null,
    investigationItems: selectedBranchId
      ? new AiReasoningService(databaseConnection).listInvestigationItems(
          caseId,
          selectedBranchId,
        )
      : [],
    runs: selectedBranchId
      ? new AiReasoningService(databaseConnection).listRuns(caseId, selectedBranchId)
      : [],
    workspace,
  };
}

export async function getAiRunComparison(
  caseId: string,
  leftRunId: string,
  rightRunId: string,
) {
  await connection();
  const caseFile = caseRepository.getCaseSummary(caseId);
  if (!caseFile) return { caseFile, comparison: null };
  try {
    return {
      caseFile,
      comparison: new AiRunComparisonService(databaseConnection).compare(
        caseId,
        leftRunId,
        rightRunId,
      ),
    };
  } catch {
    return { caseFile, comparison: null };
  }
}

export async function getInvestigationWorkspace(
  caseId: string,
  branchId?: string | null,
) {
  await connection();
  const caseFile = caseRepository.getCaseSummary(caseId);
  if (!caseFile) {
    return {
      caseFile,
      events: [],
      items: [],
      locations: [],
      people: [],
      sources: [],
      workspace: null,
    };
  }
  const workspace = reasoningWorkspaceRepository.getWorkspace(caseId, branchId);
  const selectedBranchId = workspace.selectedBranch?.id;
  return {
    caseFile,
    events: eventRepository.listTimeline(caseId, false),
    items: selectedBranchId
      ? investigationRepository.listItems(caseId, selectedBranchId)
      : [],
    locations: locationRepository.listLocations(caseId),
    people: caseRepository.listPeople(caseId),
    sources: evidenceRepository.listSources(caseId, false),
    workspace,
  };
}
