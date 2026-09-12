import type { DatabaseConnection } from "../connection";
import {
  searchEntityTypes,
  searchLayers,
  type SearchEntityType,
  type SearchLayer,
} from "../schema";

export const searchPageSize = 24;

const searchStatuses = [
  "active",
  "archived",
  "draft",
  "accepted",
  "rejected",
  "needs_review",
  "superseded",
  "pending",
  "in_progress",
  "resolved",
  "unresolved",
  "running",
  "completed",
  "failed",
  "interrupted",
  "dismissed",
  "invalid",
] as const;

export type SearchStatus = (typeof searchStatuses)[number];
export type SearchSort = "relevance" | "updated";
export type SearchFilters = {
  branchId: string | null;
  caseId: string | null;
  createdBy: "ai" | "user" | null;
  includeArchived: boolean;
  layers: SearchLayer[];
  page: number;
  query: string;
  sort: SearchSort;
  status: SearchStatus | null;
  types: SearchEntityType[];
};

export type SearchHit = {
  archived: boolean;
  branchId: string | null;
  branchName: string | null;
  caseId: string;
  caseStatus: "active" | "archived";
  caseTitle: string;
  createdBy: "ai" | "user" | null;
  entityId: string;
  entityType: SearchEntityType;
  excerpt: string;
  href: string;
  layer: SearchLayer | null;
  parentId: string | null;
  status: string;
  title: string;
  updatedAt: Date;
};

export type SearchResultPage = {
  filters: SearchFilters;
  hits: SearchHit[];
  mode: "browse" | "full_text" | "substring";
  pageCount: number;
  total: number;
};

type IndexDocument = {
  archived: number;
  body: string;
  branchId: string | null;
  caseId: string;
  createdBy: "ai" | "user" | null;
  entityId: string;
  entityType: SearchEntityType;
  keywords: string;
  layer: SearchLayer | null;
  parentId: string | null;
  status: string;
  title: string;
  updatedAt: number;
};

type RawSearchHit = Omit<SearchHit, "archived" | "excerpt" | "href" | "updatedAt"> & {
  archived: number;
  body: string;
  keywords: string;
  updatedAt: number;
};

export class SearchService {
  constructor(private readonly connection: DatabaseConnection) {}

  search(filters: SearchFilters): SearchResultPage {
    this.ensureCasesIndexed();
    const queryMode = readQueryMode(filters.query);
    const { from, parameters, where } = buildSearchQuery(filters, queryMode);
    const total = Number(
      (
        this.connection.sqlite
          .prepare(`select count(*) as count ${from} where ${where}`)
          .get(...parameters) as { count: number }
      ).count,
    );
    const pageCount = Math.max(1, Math.ceil(total / searchPageSize));
    const page = Math.min(filters.page, pageCount);
    const relevance =
      queryMode === "full_text"
        ? "bm25(search_documents_fts, 8.0, 2.0, 4.0)"
        : "0";
    const orderBy =
      filters.sort === "relevance" && queryMode === "full_text"
        ? "relevance asc, d.updated_at desc, d.id desc"
        : "d.updated_at desc, d.id desc";
    const rows = this.connection.sqlite
      .prepare(
        `select
          d.entity_type as entityType,
          d.entity_id as entityId,
          d.parent_id as parentId,
          d.case_id as caseId,
          d.branch_id as branchId,
          d.title,
          d.body,
          d.keywords,
          d.layer,
          d.status,
          d.created_by as createdBy,
          d.archived,
          d.updated_at as updatedAt,
          c.title as caseTitle,
          c.status as caseStatus,
          b.name as branchName,
          ${relevance} as relevance
        ${from}
        where ${where}
        order by ${orderBy}
        limit ? offset ?`,
      )
      .all(
        ...parameters,
        searchPageSize,
        (page - 1) * searchPageSize,
      ) as RawSearchHit[];

    return {
      filters: { ...filters, page },
      hits: rows.map((row) => ({
        archived: Boolean(row.archived),
        branchId: row.branchId,
        branchName: row.branchName,
        caseId: row.caseId,
        caseStatus: row.caseStatus,
        caseTitle: row.caseTitle,
        createdBy: row.createdBy,
        entityId: row.entityId,
        entityType: row.entityType,
        excerpt: buildExcerpt(
          [row.body, row.keywords].filter(Boolean).join(" · "),
          filters.query,
        ),
        href: buildSearchHref(row),
        layer: row.layer,
        parentId: row.parentId,
        status: row.status,
        title: row.title,
        updatedAt: new Date(row.updatedAt),
      })),
      mode: queryMode,
      pageCount,
      total,
    };
  }

  listBranches(caseId: string | null) {
    if (!caseId) return [];
    return this.connection.sqlite
      .prepare(
        `select id, name, status
         from reasoning_branches
         where case_id = ?
         order by status asc, updated_at desc, name asc`,
      )
      .all(caseId) as Array<{
        id: string;
        name: string;
        status: "active" | "archived";
      }>;
  }

  rebuildAll() {
    const caseIds = this.connection.sqlite
      .prepare("select id from cases order by created_at")
      .pluck()
      .all() as string[];
    let documents = 0;
    for (const caseId of caseIds) documents += this.rebuildCase(caseId);
    return { cases: caseIds.length, documents };
  }

  rebuildCase(caseId: string) {
    const exists = this.connection.sqlite
      .prepare("select 1 from cases where id = ?")
      .pluck()
      .get(caseId);
    if (!exists) {
      this.connection.sqlite
        .prepare("delete from search_documents where case_id = ?")
        .run(caseId);
      return 0;
    }

    const documents = this.readCaseDocuments(caseId);
    const replace = this.connection.sqlite.transaction(() => {
      this.connection.sqlite
        .prepare("delete from search_documents where case_id = ?")
        .run(caseId);
      const insert = this.connection.sqlite.prepare(
        `insert into search_documents (
          entity_type, entity_id, parent_id, case_id, branch_id,
          title, body, keywords, layer, status, created_by, archived, updated_at
        ) values (
          @entityType, @entityId, @parentId, @caseId, @branchId,
          @title, @body, @keywords, @layer, @status, @createdBy, @archived, @updatedAt
        )`,
      );
      for (const document of documents) insert.run(document);
    });
    replace();
    return documents.length;
  }

  private ensureCasesIndexed() {
    const missing = this.connection.sqlite
      .prepare(
        `select cases.id
         from cases
         left join search_documents
           on search_documents.case_id = cases.id
          and search_documents.entity_type = 'case'
         where search_documents.id is null`,
      )
      .pluck()
      .all() as string[];
    for (const caseId of missing) this.rebuildCase(caseId);
  }

  private readCaseDocuments(caseId: string) {
    return documentQueries.flatMap((query) =>
      this.connection.sqlite.prepare(query).all(caseId) as IndexDocument[],
    );
  }
}

export function parseSearchFilters(
  parameters: Record<string, string | string[] | undefined>,
): SearchFilters {
  const query = readOne(parameters.q)?.trim().slice(0, 160) ?? "";
  const pageValue = Number(readOne(parameters.page));
  const status = readOne(parameters.status);
  const author = readOne(parameters.author);
  const sort = readOne(parameters.sort);
  return {
    branchId: readSafeId(parameters.branch),
    caseId: readSafeId(parameters.case),
    createdBy: author === "ai" || author === "user" ? author : null,
    includeArchived: readOne(parameters.archived) === "1",
    layers: uniqueKnown(readMany(parameters.layer), searchLayers),
    page:
      Number.isSafeInteger(pageValue) && pageValue > 0
        ? Math.min(pageValue, 10_000)
        : 1,
    query,
    sort: sort === "updated" ? "updated" : "relevance",
    status: searchStatuses.includes(status as SearchStatus)
      ? (status as SearchStatus)
      : null,
    types: uniqueKnown(readMany(parameters.type), searchEntityTypes),
  };
}

export function buildSearchUrl(filters: SearchFilters, page = filters.page) {
  const parameters = new URLSearchParams();
  if (filters.query) parameters.set("q", filters.query);
  if (filters.caseId) parameters.set("case", filters.caseId);
  if (filters.branchId) parameters.set("branch", filters.branchId);
  for (const type of filters.types) parameters.append("type", type);
  for (const layer of filters.layers) parameters.append("layer", layer);
  if (filters.status) parameters.set("status", filters.status);
  if (filters.createdBy) parameters.set("author", filters.createdBy);
  if (filters.includeArchived) parameters.set("archived", "1");
  if (filters.sort !== "relevance") parameters.set("sort", filters.sort);
  if (page > 1) parameters.set("page", String(page));
  const query = parameters.toString();
  return query ? `/search?${query}` : "/search";
}

function buildSearchQuery(
  filters: SearchFilters,
  mode: SearchResultPage["mode"],
) {
  const from =
    mode === "full_text"
      ? `from search_documents_fts
         join search_documents d on d.id = search_documents_fts.rowid
         join cases c on c.id = d.case_id
         left join reasoning_branches b on b.id = d.branch_id`
      : `from search_documents d
         join cases c on c.id = d.case_id
         left join reasoning_branches b on b.id = d.branch_id`;
  const conditions: string[] = [];
  const parameters: Array<number | string> = [];

  if (mode === "full_text") {
    conditions.push("search_documents_fts match ?");
    parameters.push(buildFtsQuery(filters.query));
  } else if (mode === "substring") {
    conditions.push(
      "(d.title like ? escape '\\' or d.body like ? escape '\\' or d.keywords like ? escape '\\')",
    );
    const pattern = `%${escapeLike(filters.query)}%`;
    parameters.push(pattern, pattern, pattern);
  }
  if (!filters.includeArchived) {
    conditions.push("c.status = 'active'", "d.archived = 0");
  }
  if (filters.caseId) {
    conditions.push("d.case_id = ?");
    parameters.push(filters.caseId);
  }
  if (filters.branchId) {
    conditions.push("d.branch_id = ?");
    parameters.push(filters.branchId);
  }
  if (filters.types.length > 0) {
    conditions.push(`d.entity_type in (${placeholders(filters.types.length)})`);
    parameters.push(...filters.types);
  }
  if (filters.layers.length > 0) {
    conditions.push(`d.layer in (${placeholders(filters.layers.length)})`);
    parameters.push(...filters.layers);
  }
  if (filters.status) {
    conditions.push("d.status = ?");
    parameters.push(filters.status);
  }
  if (filters.createdBy) {
    conditions.push("d.created_by = ?");
    parameters.push(filters.createdBy);
  }
  return { from, parameters, where: conditions.join(" and ") || "1 = 1" };
}

function readQueryMode(query: string): SearchResultPage["mode"] {
  if (!query) return "browse";
  const terms = query.split(/\s+/u).filter(Boolean);
  return terms.length > 0 && terms.every((term) => Array.from(term).length >= 3)
    ? "full_text"
    : "substring";
}

function buildFtsQuery(query: string) {
  return query
    .split(/\s+/u)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" AND ");
}

function escapeLike(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function placeholders(length: number) {
  return Array.from({ length }, () => "?").join(", ");
}

function readOne(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function readMany(value: string | string[] | undefined) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function readSafeId(value: string | string[] | undefined) {
  const candidate = readOne(value)?.trim();
  return candidate && candidate.length <= 128 && !/[\u0000-\u001f]/u.test(candidate)
    ? candidate
    : null;
}

function uniqueKnown<T extends string>(values: string[], allowed: readonly T[]) {
  return [...new Set(values.filter((value): value is T => allowed.includes(value as T)))];
}

function buildExcerpt(value: string, query: string) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) return "没有补充摘要。";
  if (!query) return truncate(normalized, 180);
  const terms = query.split(/\s+/u).filter(Boolean);
  const lowered = normalized.toLocaleLowerCase("zh-CN");
  const matched = terms
    .map((term) => lowered.indexOf(term.toLocaleLowerCase("zh-CN")))
    .find((index) => index >= 0);
  if (matched === undefined) return truncate(normalized, 180);
  const start = Math.max(0, matched - 55);
  const excerpt = normalized.slice(start, start + 180);
  return `${start > 0 ? "…" : ""}${excerpt}${start + 180 < normalized.length ? "…" : ""}`;
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function buildSearchHref(row: RawSearchHit) {
  const caseRoot = `/cases/${row.caseId}`;
  switch (row.entityType) {
    case "case":
      return caseRoot;
    case "person":
      return `${caseRoot}#person-${row.entityId}`;
    case "location":
      return `${caseRoot}/timeline#location-${row.entityId}`;
    case "event":
      return `${caseRoot}/timeline#event-${row.entityId}`;
    case "source":
      return `${caseRoot}/evidence#source-${row.entityId}`;
    case "claim":
      return row.layer === "fixed"
        ? `${caseRoot}/evidence#claim-${row.entityId}`
        : `${caseRoot}/reasoning${row.branchId ? `?branch=${row.branchId}` : ""}#claim-${row.entityId}`;
    case "branch":
      return `${caseRoot}/reasoning?branch=${row.entityId}`;
    case "investigation":
      return `${caseRoot}/investigations?branch=${row.branchId ?? ""}#investigation-${row.entityId}`;
    case "ai_run":
      return `${caseRoot}/reasoning/ai?branch=${row.branchId ?? ""}#run-${row.entityId}`;
    case "ai_suggestion":
      return `${caseRoot}/reasoning/ai?branch=${row.branchId ?? ""}#run-${row.parentId ?? ""}`;
  }
}

const documentQueries = [
  `select
    'case' as entityType, id as entityId, null as parentId, id as caseId,
    null as branchId, title, description as body, timeline_mode as keywords,
    null as layer, status, null as createdBy,
    case when status = 'archived' then 1 else 0 end as archived,
    updated_at as updatedAt
  from cases where id = ?`,
  `select
    'person' as entityType, p.id as entityId, null as parentId, p.case_id as caseId,
    null as branchId, p.display_name as title, p.description as body,
    trim(p.id || ' ' || coalesce((
      select group_concat(pa.alias, ' ') from person_aliases pa where pa.person_id = p.id
    ), '')) as keywords,
    null as layer, 'active' as status, null as createdBy, 0 as archived,
    p.updated_at as updatedAt
  from people p where p.case_id = ?`,
  `select
    'location' as entityType, l.id as entityId, l.parent_location_id as parentId,
    l.case_id as caseId, null as branchId, l.name as title, l.description as body,
    trim(l.id || ' ' || coalesce(parent.name, '')) as keywords,
    null as layer, 'active' as status, null as createdBy, 0 as archived,
    l.updated_at as updatedAt
  from locations l
  left join locations parent on parent.id = l.parent_location_id
  where l.case_id = ?`,
  `select
    'event' as entityType, e.id as entityId, e.anchor_event_id as parentId,
    e.case_id as caseId, null as branchId, e.title, e.description as body,
    trim(e.id || ' ' || coalesce(e.display_time, '') || ' ' || coalesce(l.name, '') || ' ' || coalesce((
      select group_concat(p.display_name || ' ' || ep.notes, ' ')
      from event_participants ep join people p on p.id = ep.person_id
      where ep.event_id = e.id
    ), '')) as keywords,
    null as layer, case when e.archived_at is null then 'active' else 'archived' end as status,
    null as createdBy, case when e.archived_at is null then 0 else 1 end as archived,
    e.updated_at as updatedAt
  from events e
  left join locations l on l.id = e.location_id
  where e.case_id = ?`,
  `select
    'source' as entityType, s.id as entityId, null as parentId, s.case_id as caseId,
    null as branchId, s.title, trim(coalesce(s.excerpt, '') || ' ' || s.notes) as body,
    trim(s.id || ' ' || s.kind || ' ' || coalesce(s.locator, '')) as keywords,
    null as layer, case when s.archived_at is null then 'active' else 'archived' end as status,
    null as createdBy, case when s.archived_at is null then 0 else 1 end as archived,
    s.updated_at as updatedAt
  from sources s where s.case_id = ?`,
  `select
    'branch' as entityType, b.id as entityId, b.parent_branch_id as parentId,
    b.case_id as caseId, b.id as branchId, b.name as title, b.description as body,
    b.id as keywords, null as layer, b.status, null as createdBy,
    case when b.status = 'archived' then 1 else 0 end as archived,
    b.updated_at as updatedAt
  from reasoning_branches b where b.case_id = ?`,
  `select
    'claim' as entityType, cl.id as entityId, null as parentId, cl.case_id as caseId,
    cl.branch_id as branchId, substr(cl.content, 1, 120) as title, cl.content as body,
    trim(cl.id || ' ' || cl.kind || ' ' || coalesce(p.display_name, '') || ' ' || coalesce(b.name, '') || ' ' ||
      coalesce((select group_concat(s.title, ' ') from claim_sources cs join sources s on s.id = cs.source_id where cs.claim_id = cl.id), '') || ' ' ||
      coalesce((select group_concat(p2.display_name, ' ') from claim_people cp join people p2 on p2.id = cp.person_id where cp.claim_id = cl.id), '') || ' ' ||
      coalesce((select group_concat(e.title, ' ') from claim_events ce join events e on e.id = ce.event_id where ce.claim_id = cl.id), '') || ' ' ||
      coalesce((select group_concat(l.name, ' ') from claim_locations lnk join locations l on l.id = lnk.location_id where lnk.claim_id = cl.id), '')
    ) as keywords,
    case
      when cl.kind in ('fact', 'statement') then 'fixed'
      when cl.kind = 'inference' and cl.status = 'accepted' then 'trusted'
      else 'draft'
    end as layer,
    cl.status, cl.created_by as createdBy,
    case when cl.archived_at is null then 0 else 1 end as archived,
    cl.updated_at as updatedAt
  from claims cl
  left join people p on p.id = cl.speaker_person_id
  left join reasoning_branches b on b.id = cl.branch_id
  where cl.case_id = ?`,
  `select
    'investigation' as entityType, i.id as entityId, i.origin_suggestion_id as parentId,
    i.case_id as caseId, i.branch_id as branchId, i.title,
    trim(i.question || ' ' || i.notes || ' ' || i.result_summary) as body,
    trim(i.id || ' ' || i.priority || ' ' || coalesce(b.name, '') || ' ' ||
      coalesce((select group_concat(p.display_name, ' ') from investigation_item_people ip join people p on p.id = ip.person_id where ip.investigation_item_id = i.id), '') || ' ' ||
      coalesce((select group_concat(e.title, ' ') from investigation_item_events ie join events e on e.id = ie.event_id where ie.investigation_item_id = i.id), '') || ' ' ||
      coalesce((select group_concat(l.name, ' ') from investigation_item_locations il join locations l on l.id = il.location_id where il.investigation_item_id = i.id), '') || ' ' ||
      coalesce((select group_concat(s.title, ' ') from investigation_item_sources ins join sources s on s.id = ins.source_id where ins.investigation_item_id = i.id), '')
    ) as keywords,
    null as layer, i.status, i.created_by as createdBy, 0 as archived,
    i.updated_at as updatedAt
  from investigation_items i
  left join reasoning_branches b on b.id = i.branch_id
  where i.case_id = ?`,
  `select
    'ai_run' as entityType, r.id as entityId, r.retry_of_run_id as parentId,
    r.case_id as caseId, r.branch_id as branchId,
    case r.mode
      when 'consistency_check' then 'AI 一致性检查'
      when 'hypothesis_expansion' then 'AI 假设扩展'
      when 'counterexample_search' then 'AI 反例搜索'
      else 'AI 调查缺口'
    end as title,
    trim(r.summary || ' ' || r.user_prompt || ' ' || coalesce(r.error_message, '')) as body,
    trim(r.id || ' ' || r.mode || ' ' || r.provider || ' ' || r.model || ' ' || b.name) as keywords,
    null as layer, r.status, 'ai' as createdBy,
    case when b.status = 'archived' then 1 else 0 end as archived,
    coalesce(r.completed_at, r.created_at) as updatedAt
  from reasoning_runs r
  join reasoning_branches b on b.id = r.branch_id
  where r.case_id = ?`,
  `select
    'ai_suggestion' as entityType, s.id as entityId, r.id as parentId,
    r.case_id as caseId, r.branch_id as branchId,
    coalesce(edit.title, s.title) as title,
    trim(coalesce(edit.content, s.content) || ' ' || coalesce(edit.rationale, s.rationale) || ' ' || s.resolution_note) as body,
    trim(s.id || ' ' || s.kind || ' ' || s.title || ' ' || s.content || ' ' || s.rationale || ' ' || r.model || ' ' || b.name) as keywords,
    'draft' as layer, s.status, 'ai' as createdBy,
    case when b.status = 'archived' then 1 else 0 end as archived,
    coalesce(edit.edited_at, s.resolved_at, s.created_at) as updatedAt
  from reasoning_suggestions s
  join reasoning_runs r on r.id = s.run_id
  join reasoning_branches b on b.id = r.branch_id
  left join reasoning_suggestion_edits edit on edit.id = (
    select latest.id from reasoning_suggestion_edits latest
    where latest.suggestion_id = s.id
    order by latest.revision desc limit 1
  )
  where r.case_id = ?`,
] as const;
