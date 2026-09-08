import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import type { DatabaseConnection } from "../connection";
import { cases, locations } from "../schema";

type LocationRow = typeof locations.$inferSelect;

export class LocationRepository {
  constructor(private readonly connection: DatabaseConnection) {}

  listLocations(caseId: string): LocationRow[] {
    return this.connection.db
      .select()
      .from(locations)
      .where(eq(locations.caseId, caseId))
      .orderBy(asc(locations.sortOrder), asc(locations.createdAt))
      .all();
  }

  createLocation(input: {
    caseId: string;
    name: string;
    description?: string;
    parentLocationId?: string | null;
    sortOrder?: number;
  }): LocationRow {
    this.assertCaseExists(input.caseId);
    this.assertParentBelongsToCase(
      input.caseId,
      input.parentLocationId ?? null,
    );

    const create = this.connection.sqlite.transaction(() => {
      const location = this.connection.db
        .insert(locations)
        .values({
          id: randomUUID(),
          caseId: input.caseId,
          name: requireText(input.name, "Location name"),
          description: input.description?.trim() ?? "",
          parentLocationId: input.parentLocationId ?? null,
          sortOrder: input.sortOrder ?? 0,
        })
        .returning()
        .get();

      this.touchCase(input.caseId);
      return location;
    });

    return create();
  }

  updateLocation(
    caseId: string,
    locationId: string,
    input: {
      name: string;
      description?: string;
      parentLocationId?: string | null;
      sortOrder?: number;
    },
  ): LocationRow {
    const current = this.getLocationForCase(caseId, locationId);
    const parentLocationId = input.parentLocationId ?? null;

    this.assertParentBelongsToCase(caseId, parentLocationId);
    if (
      parentLocationId &&
      (parentLocationId === locationId ||
        this.wouldCreateParentCycle(locationId, parentLocationId))
    ) {
      throw new Error("A location cannot contain itself through its parent chain.");
    }

    const update = this.connection.sqlite.transaction(() => {
      const updated = this.connection.db
        .update(locations)
        .set({
          name: requireText(input.name, "Location name"),
          description: input.description?.trim() ?? "",
          parentLocationId,
          sortOrder: input.sortOrder ?? current.sortOrder,
          updatedAt: new Date(),
        })
        .where(and(eq(locations.id, locationId), eq(locations.caseId, caseId)))
        .returning()
        .get();

      if (!updated) {
        throw new Error("Location must belong to the requested case.");
      }

      this.touchCase(caseId);
      return updated;
    });

    return update();
  }

  private getLocationForCase(caseId: string, locationId: string) {
    const location = this.connection.db
      .select()
      .from(locations)
      .where(and(eq(locations.id, locationId), eq(locations.caseId, caseId)))
      .get();

    if (!location) {
      throw new Error("Location must belong to the requested case.");
    }

    return location;
  }

  private assertCaseExists(caseId: string) {
    const caseFile = this.connection.db
      .select({ id: cases.id })
      .from(cases)
      .where(eq(cases.id, caseId))
      .get();

    if (!caseFile) {
      throw new Error(`Case not found: ${caseId}`);
    }
  }

  private assertParentBelongsToCase(
    caseId: string,
    parentLocationId: string | null,
  ) {
    if (!parentLocationId) {
      return;
    }

    const parent = this.connection.db
      .select({ caseId: locations.caseId })
      .from(locations)
      .where(eq(locations.id, parentLocationId))
      .get();

    if (!parent || parent.caseId !== caseId) {
      throw new Error("Parent location must belong to the same case.");
    }
  }

  private wouldCreateParentCycle(
    locationId: string,
    parentLocationId: string,
  ) {
    return Boolean(
      this.connection.sqlite
        .prepare(
          `
            with recursive ancestors(id) as (
              select ?
              union
              select parent_location_id
              from locations
              join ancestors on locations.id = ancestors.id
              where parent_location_id is not null
            )
            select 1
            from ancestors
            where id = ?
            limit 1
          `,
        )
        .get(parentLocationId, locationId),
    );
  }

  private touchCase(caseId: string) {
    this.connection.db
      .update(cases)
      .set({ updatedAt: new Date() })
      .where(eq(cases.id, caseId))
      .run();
  }
}

function requireText(value: string, label: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label} cannot be empty.`);
  }

  return normalized;
}
