import "server-only";

import { connection } from "next/server";

import { databaseConnection } from "@/db/client";
import { CaseRepository } from "@/db/repositories/case-repository";
import { EvidenceRepository } from "@/db/repositories/evidence-repository";
import { EventRepository } from "@/db/repositories/event-repository";
import { LocationRepository } from "@/db/repositories/location-repository";

const caseRepository = new CaseRepository(databaseConnection);
const evidenceRepository = new EvidenceRepository(databaseConnection);
const eventRepository = new EventRepository(databaseConnection);
const locationRepository = new LocationRepository(databaseConnection);

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
