import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import { fingerprintReasoningContext } from "../ai/context-snapshot";
import type { DatabaseConnection } from "../db/connection";

export const CASE_BUNDLE_FORMAT = "delightive.case";
export const CASE_BUNDLE_VERSION = 1;
export const CASE_BUNDLE_FILE_SUFFIX = ".delightive.json";
export const MAX_CASE_BUNDLE_BYTES = 10 * 1024 * 1024;

const APP_VERSION = "0.1.0";
const MAX_ROWS_PER_TABLE = 50_000;
const MAX_TOTAL_ROWS = 100_000;
const MAX_TEXT_LENGTH = 1_000_000;

const tableSpecs = [
  { name: "cases" },
  { name: "people", scope: ["case_id", "cases"] },
  { name: "person_aliases", scope: ["person_id", "people"] },
  { name: "locations", scope: ["case_id", "cases"], deferred: "parent_location_id" },
  { name: "events", scope: ["case_id", "cases"], deferred: "anchor_event_id" },
  { name: "event_participants", scope: ["event_id", "events"] },
  { name: "event_revisions", scope: ["event_id", "events"] },
  { name: "sources", scope: ["case_id", "cases"] },
  { name: "source_revisions", scope: ["source_id", "sources"] },
  { name: "event_sources", scope: ["event_id", "events"] },
  { name: "reasoning_branches", scope: ["case_id", "cases"], deferred: "parent_branch_id" },
  { name: "claims", scope: ["case_id", "cases"] },
  { name: "claim_sources", scope: ["claim_id", "claims"] },
  { name: "claim_links", scope: ["premise_claim_id", "claims"] },
  { name: "claim_revisions", scope: ["claim_id", "claims"] },
  { name: "claim_reviews", scope: ["claim_id", "claims"] },
  { name: "contradiction_reviews", scope: ["claim_link_id", "claim_links"] },
  { name: "claim_people", scope: ["claim_id", "claims"] },
  { name: "claim_events", scope: ["claim_id", "claims"] },
  { name: "claim_locations", scope: ["claim_id", "claims"] },
  { name: "reasoning_runs", scope: ["case_id", "cases"], deferred: "retry_of_run_id" },
  { name: "reasoning_run_inputs", scope: ["run_id", "reasoning_runs"] },
  { name: "reasoning_suggestions", scope: ["run_id", "reasoning_runs"] },
  { name: "reasoning_suggestion_edits", scope: ["suggestion_id", "reasoning_suggestions"] },
  { name: "investigation_items", scope: ["case_id", "cases"] },
  { name: "investigation_item_claims", scope: ["investigation_item_id", "investigation_items"] },
  { name: "investigation_item_people", scope: ["investigation_item_id", "investigation_items"] },
  { name: "investigation_item_events", scope: ["investigation_item_id", "investigation_items"] },
  { name: "investigation_item_locations", scope: ["investigation_item_id", "investigation_items"] },
  { name: "investigation_item_sources", scope: ["investigation_item_id", "investigation_items"] },
  { name: "investigation_item_updates", scope: ["investigation_item_id", "investigation_items"] },
] as const;

export const CASE_BUNDLE_TABLES = tableSpecs.map((spec) => spec.name);

type TableName = (typeof tableSpecs)[number]["name"];
type SqlValue = string | number | null;
export type CaseBundleRow = Record<string, SqlValue>;
type CaseBundleTables = Record<TableName, CaseBundleRow[]>;

export type CaseBundleV1 = {
  appVersion: string;
  exportedAt: string;
  format: typeof CASE_BUNDLE_FORMAT;
  formatVersion: typeof CASE_BUNDLE_VERSION;
  tables: CaseBundleTables;
};

export type CaseBundleCounts = {
  claims: number;
  events: number;
  investigationItems: number;
  people: number;
  reasoningBranches: number;
  reasoningRuns: number;
  reasoningSuggestions: number;
  sources: number;
  totalRows: number;
};

export type CaseBundlePreview = {
  appVersion: string;
  counts: CaseBundleCounts;
  exportedAt: string;
  formatVersion: number;
  originalTitle: string;
  warnings: string[];
};

export class CaseBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaseBundleError";
  }
}

type ColumnInfo = {
  name: string;
  notnull: 0 | 1;
  pk: number;
  type: string;
};

type ForeignKeyInfo = {
  from: string;
  table: string;
  to: string;
};

type SchemaInfo = Record<
  TableName,
  { columns: ColumnInfo[]; foreignKeys: ForeignKeyInfo[] }
>;

const jsonColumns = new Set([
  "event_revisions.snapshot",
  "source_revisions.snapshot",
  "claim_revisions.snapshot",
  "claim_reviews.premise_snapshot",
  "reasoning_run_inputs.context_json",
  "reasoning_suggestions.citations_json",
  "reasoning_suggestions.validation_issues_json",
  "reasoning_suggestion_edits.citations_json",
]);

const logicalReferences: Partial<
  Record<TableName, Record<string, TableName>>
> = {
  reasoning_suggestion_edits: {
    secondary_claim_id: "claims",
    target_claim_id: "claims",
  },
  reasoning_suggestions: {
    secondary_claim_id: "claims",
    target_claim_id: "claims",
  },
};

const insertionOrder: TableName[] = [
  "cases",
  "people",
  "person_aliases",
  "locations",
  "events",
  "event_participants",
  "event_revisions",
  "sources",
  "source_revisions",
  "event_sources",
  "reasoning_branches",
  "claims",
  "claim_sources",
  "claim_links",
  "claim_revisions",
  "claim_reviews",
  "contradiction_reviews",
  "claim_people",
  "claim_events",
  "claim_locations",
  "reasoning_runs",
  "reasoning_run_inputs",
  "reasoning_suggestions",
  "reasoning_suggestion_edits",
  "investigation_items",
  "investigation_item_claims",
  "investigation_item_people",
  "investigation_item_events",
  "investigation_item_locations",
  "investigation_item_sources",
  "investigation_item_updates",
];

export function exportCaseBundle(
  connection: DatabaseConnection,
  caseId: string,
): CaseBundleV1 {
  const schema = readSchema(connection.sqlite);
  const tables = {} as CaseBundleTables;
  for (const table of CASE_BUNDLE_TABLES) {
    tables[table] = [];
  }
  const caseRow = connection.sqlite
    .prepare("select * from cases where id = ?")
    .get(caseId) as CaseBundleRow | undefined;

  if (!caseRow) {
    throw new CaseBundleError("案件不存在，无法导出。");
  }

  tables.cases = [prepareExportRow("cases", normalizeDatabaseRow(caseRow))];

  for (const spec of tableSpecs) {
    if (!("scope" in spec)) continue;
    const [scopeColumn, parentTable] = spec.scope;
    const parentIds = tables[parentTable]
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string");
    tables[spec.name] = selectRowsByValues(
      connection.sqlite,
      spec.name,
      scopeColumn,
      parentIds,
    ).map((row) => prepareExportRow(spec.name, normalizeDatabaseRow(row)));
  }

  for (const table of CASE_BUNDLE_TABLES) {
    tables[table] = sortRows(tables[table], schema[table].columns);
  }

  const bundle: CaseBundleV1 = {
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    format: CASE_BUNDLE_FORMAT,
    formatVersion: CASE_BUNDLE_VERSION,
    tables,
  };

  return validateCaseBundle(connection, bundle);
}

export function serializeCaseBundle(bundle: CaseBundleV1) {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function parseCaseBundleText(
  connection: DatabaseConnection,
  source: string,
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new CaseBundleError("文件不是有效的 JSON 案件包。");
  }
  return validateCaseBundle(connection, parsed);
}

export function validateCaseBundle(
  connection: DatabaseConnection,
  input: unknown,
): CaseBundleV1 {
  if (!isRecord(input)) {
    throw new CaseBundleError("案件包的顶层结构无效。");
  }
  assertExactKeys(input, [
    "appVersion",
    "exportedAt",
    "format",
    "formatVersion",
    "tables",
  ], "案件包");
  if (input.format !== CASE_BUNDLE_FORMAT) {
    throw new CaseBundleError("这不是 Delightive 案件包。");
  }
  if (input.formatVersion !== CASE_BUNDLE_VERSION) {
    throw new CaseBundleError(
      `不支持的案件包版本：${String(input.formatVersion)}。当前仅支持版本 ${CASE_BUNDLE_VERSION}。`,
    );
  }
  if (
    typeof input.appVersion !== "string" ||
    !input.appVersion ||
    input.appVersion.length > 50
  ) {
    throw new CaseBundleError("案件包缺少有效的应用版本。");
  }
  if (
    typeof input.exportedAt !== "string" ||
    input.exportedAt.length > 50 ||
    Number.isNaN(Date.parse(input.exportedAt))
  ) {
    throw new CaseBundleError("案件包缺少有效的导出时间。");
  }
  if (!isRecord(input.tables)) {
    throw new CaseBundleError("案件包缺少数据表。");
  }
  assertExactKeys(input.tables, CASE_BUNDLE_TABLES, "案件包数据表");

  const schema = readSchema(connection.sqlite);
  let totalRows = 0;

  for (const table of CASE_BUNDLE_TABLES) {
    const rows = input.tables[table];
    if (!Array.isArray(rows)) {
      throw new CaseBundleError(`数据表 ${table} 必须是数组。`);
    }
    if (rows.length > MAX_ROWS_PER_TABLE) {
      throw new CaseBundleError(`数据表 ${table} 的记录数超过限制。`);
    }
    totalRows += rows.length;
    if (totalRows > MAX_TOTAL_ROWS) {
      throw new CaseBundleError("案件包的总记录数超过限制。");
    }

    for (const [index, row] of rows.entries()) {
      validateRow(table, index, row, schema[table].columns);
    }
  }

  const bundle = input as CaseBundleV1;
  if (bundle.tables.cases.length !== 1) {
    throw new CaseBundleError("一个案件包必须且只能包含一份案件。");
  }
  const caseRow = bundle.tables.cases[0];
  if (
    typeof caseRow.id !== "string" ||
    !caseRow.id ||
    typeof caseRow.title !== "string" ||
    !caseRow.title.trim() ||
    caseRow.title.length > 120
  ) {
    throw new CaseBundleError("案件包中的案件编号或名称无效。");
  }

  validatePrimaryKeys(bundle, schema);
  validateReferences(bundle, schema);
  validateCaseOwnership(bundle, caseRow.id);
  validateSelfReferenceCycles(bundle, "locations", "parent_location_id");
  validateSelfReferenceCycles(bundle, "events", "anchor_event_id");
  validateSelfReferenceCycles(bundle, "reasoning_branches", "parent_branch_id");
  validateSelfReferenceCycles(bundle, "reasoning_runs", "retry_of_run_id");

  return bundle;
}

export function previewCaseBundle(
  connection: DatabaseConnection,
  input: unknown,
): CaseBundlePreview {
  const bundle = validateCaseBundle(connection, input);
  return buildPreview(bundle);
}

export function importCaseBundle(
  connection: DatabaseConnection,
  input: unknown,
  titleOverride?: string,
) {
  const bundle = validateCaseBundle(connection, input);
  const normalizedTitle = titleOverride?.trim();
  if (titleOverride !== undefined && (!normalizedTitle || normalizedTitle.length > 120)) {
    throw new CaseBundleError("导入后的案件名称应为 1 至 120 个字符。");
  }

  const schema = readSchema(connection.sqlite);
  const { idMaps, rows } = remapBundle(bundle, schema);
  if (normalizedTitle) {
    rows.cases[0].title = normalizedTitle;
  }

  const insertAll = connection.sqlite.transaction(() => {
    for (const table of insertionOrder) {
      insertRows(connection.sqlite, table, rows[table], schema[table].columns);
      const spec = tableSpecs.find((candidate) => candidate.name === table);
      if (spec && "deferred" in spec) {
        restoreDeferredReferences(
          connection.sqlite,
          table,
          spec.deferred,
          bundle.tables[table],
          idMaps,
          schema,
        );
      }
    }
  });

  try {
    insertAll();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知数据库错误";
    console.error("Case bundle import failed:", detail);
    throw new CaseBundleError("案件包未能写入；数据库已保持导入前状态。");
  }

  const caseId = idMaps.cases.get(bundle.tables.cases[0].id as string);
  if (!caseId) {
    throw new CaseBundleError("导入后未能取得新的案件编号。");
  }

  return {
    caseId,
    counts: buildCounts(bundle),
    title: rows.cases[0].title as string,
    url: `/cases/${caseId}`,
  };
}

export function buildCaseBundleFilename(title: string) {
  const base = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 80) || "delightive-case";
  return `${base}${CASE_BUNDLE_FILE_SUFFIX}`;
}

function buildPreview(bundle: CaseBundleV1): CaseBundlePreview {
  const runningRuns = bundle.tables.reasoning_runs.filter(
    (row) => row.status === "running",
  ).length;
  const warnings = runningRuns
    ? [`包含 ${runningRuns} 条尚未完成的 AI 运行记录；导入后将作为历史状态保留。`]
    : [];
  return {
    appVersion: bundle.appVersion,
    counts: buildCounts(bundle),
    exportedAt: bundle.exportedAt,
    formatVersion: bundle.formatVersion,
    originalTitle: bundle.tables.cases[0].title as string,
    warnings,
  };
}

function buildCounts(bundle: CaseBundleV1): CaseBundleCounts {
  return {
    claims: bundle.tables.claims.length,
    events: bundle.tables.events.length,
    investigationItems: bundle.tables.investigation_items.length,
    people: bundle.tables.people.length,
    reasoningBranches: bundle.tables.reasoning_branches.length,
    reasoningRuns: bundle.tables.reasoning_runs.length,
    reasoningSuggestions: bundle.tables.reasoning_suggestions.length,
    sources: bundle.tables.sources.length,
    totalRows: CASE_BUNDLE_TABLES.reduce(
      (total, table) => total + bundle.tables[table].length,
      0,
    ),
  };
}

function readSchema(sqlite: Database.Database): SchemaInfo {
  return Object.fromEntries(
    CASE_BUNDLE_TABLES.map((table) => {
      const columns = sqlite
        .prepare(`pragma table_info(${quoteIdentifier(table)})`)
        .all() as ColumnInfo[];
      if (columns.length === 0) {
        throw new CaseBundleError(`当前数据库缺少必要的数据表 ${table}。`);
      }
      const foreignKeys = sqlite
        .prepare(`pragma foreign_key_list(${quoteIdentifier(table)})`)
        .all() as ForeignKeyInfo[];
      return [table, { columns, foreignKeys }];
    }),
  ) as SchemaInfo;
}

function selectRowsByValues(
  sqlite: Database.Database,
  table: TableName,
  column: string,
  values: string[],
) {
  const result: CaseBundleRow[] = [];
  for (let offset = 0; offset < values.length; offset += 400) {
    const chunk = values.slice(offset, offset + 400);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = sqlite
      .prepare(
        `select * from ${quoteIdentifier(table)} where ${quoteIdentifier(column)} in (${placeholders})`,
      )
      .all(...chunk) as CaseBundleRow[];
    result.push(...rows);
  }
  return result;
}

function normalizeDatabaseRow(row: CaseBundleRow): CaseBundleRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (value === null || typeof value === "string" || typeof value === "number") {
        return [key, value];
      }
      throw new CaseBundleError(`数据列 ${key} 使用了案件包不支持的类型。`);
    }),
  );
}

function prepareExportRow(table: TableName, row: CaseBundleRow) {
  return Object.fromEntries(
    Object.entries(row).map(([column, value]) => {
      if (typeof value !== "string") return [column, value];
      if (jsonColumns.has(`${table}.${column}`)) {
        try {
          return [column, JSON.stringify(redactLocalPaths(JSON.parse(value)))];
        } catch {
          return [column, value];
        }
      }
      return [column, redactLocalPaths(value)];
    }),
  ) as CaseBundleRow;
}

function redactLocalPaths(value: unknown): unknown {
  if (typeof value === "string") {
    if (!/^(?:[a-zA-Z]:[\\/]|\\\\|\/(?!\/)|file:\/\/)/.test(value)) {
      return value;
    }
    const filename = value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1);
    return filename ? `[本机路径已省略]/${filename}` : "[本机路径已省略]";
  }
  if (Array.isArray(value)) return value.map(redactLocalPaths);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactLocalPaths(child)]),
    );
  }
  return value;
}

function sortRows(rows: CaseBundleRow[], columns: ColumnInfo[]) {
  const primaryColumns = columns
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
  const sortColumns = primaryColumns.length
    ? primaryColumns
    : columns.map((column) => column.name);
  return rows.sort((left, right) => {
    for (const column of sortColumns) {
      const comparison = String(left[column] ?? "").localeCompare(
        String(right[column] ?? ""),
      );
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
}

function validateRow(
  table: TableName,
  index: number,
  input: unknown,
  columns: ColumnInfo[],
) {
  if (!isRecord(input)) {
    throw new CaseBundleError(`数据表 ${table} 的第 ${index + 1} 条记录无效。`);
  }
  assertExactKeys(
    input,
    columns.map((column) => column.name),
    `数据表 ${table} 的第 ${index + 1} 条记录`,
  );
  for (const column of columns) {
    const value = input[column.name];
    if (value === null) {
      if (column.notnull || column.pk) {
        throw new CaseBundleError(`数据表 ${table} 的 ${column.name} 不能为空。`);
      }
      continue;
    }
    if (column.type.toUpperCase().includes("INT")) {
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw new CaseBundleError(`数据表 ${table} 的 ${column.name} 必须是整数。`);
      }
    } else if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH) {
      throw new CaseBundleError(`数据表 ${table} 的 ${column.name} 必须是有效文本。`);
    }
    if (jsonColumns.has(`${table}.${column.name}`)) {
      try {
        JSON.parse(value as string);
      } catch {
        throw new CaseBundleError(`数据表 ${table} 的 ${column.name} 不是有效 JSON。`);
      }
    }
  }
}

function validatePrimaryKeys(bundle: CaseBundleV1, schema: SchemaInfo) {
  const globalIds = new Set<string>();
  for (const table of CASE_BUNDLE_TABLES) {
    const primaryColumns = schema[table].columns
      .filter((column) => column.pk > 0)
      .sort((left, right) => left.pk - right.pk);
    const seen = new Set<string>();
    for (const row of bundle.tables[table]) {
      const key = JSON.stringify(primaryColumns.map((column) => row[column.name]));
      if (seen.has(key)) {
        throw new CaseBundleError(`数据表 ${table} 包含重复的主键。`);
      }
      seen.add(key);
      if (Object.hasOwn(row, "id")) {
        const id = row.id;
        if (typeof id !== "string" || !id) {
          throw new CaseBundleError(`数据表 ${table} 包含无效编号。`);
        }
        if (globalIds.has(id)) {
          throw new CaseBundleError(`案件包中的编号 ${id} 被重复使用。`);
        }
        globalIds.add(id);
      }
    }
  }
}

function validateReferences(bundle: CaseBundleV1, schema: SchemaInfo) {
  const valueSets = new Map<string, Set<SqlValue>>();
  const valuesFor = (table: TableName, column: string) => {
    const key = `${table}.${column}`;
    let values = valueSets.get(key);
    if (!values) {
      values = new Set(bundle.tables[table].map((row) => row[column]));
      valueSets.set(key, values);
    }
    return values;
  };

  for (const table of CASE_BUNDLE_TABLES) {
    for (const foreignKey of schema[table].foreignKeys) {
      if (!isTableName(foreignKey.table)) continue;
      const allowed = valuesFor(foreignKey.table, foreignKey.to);
      for (const row of bundle.tables[table]) {
        const value = row[foreignKey.from];
        if (value !== null && !allowed.has(value)) {
          throw new CaseBundleError(
            `数据表 ${table} 的 ${foreignKey.from} 指向案件包之外的记录。`,
          );
        }
      }
    }
  }
}

function validateCaseOwnership(bundle: CaseBundleV1, caseId: SqlValue) {
  for (const table of CASE_BUNDLE_TABLES) {
    for (const row of bundle.tables[table]) {
      if (Object.hasOwn(row, "case_id") && row.case_id !== caseId) {
        throw new CaseBundleError(`数据表 ${table} 混入了其他案件的数据。`);
      }
    }
  }
}

function validateSelfReferenceCycles(
  bundle: CaseBundleV1,
  table: TableName,
  parentColumn: string,
) {
  const parentById = new Map(
    bundle.tables[table].map((row) => [row.id as string, row[parentColumn]]),
  );
  for (const id of parentById.keys()) {
    const visited = new Set<string>();
    let cursor: SqlValue | undefined = id;
    while (typeof cursor === "string") {
      if (visited.has(cursor)) {
        throw new CaseBundleError(`数据表 ${table} 包含循环引用。`);
      }
      visited.add(cursor);
      cursor = parentById.get(cursor);
    }
  }
}

function remapBundle(bundle: CaseBundleV1, schema: SchemaInfo) {
  const idMaps = Object.fromEntries(
    CASE_BUNDLE_TABLES.map((table) => [table, new Map<string, string>()]),
  ) as Record<TableName, Map<string, string>>;
  const globalIdMap = new Map<string, string>();

  for (const table of CASE_BUNDLE_TABLES) {
    for (const row of bundle.tables[table]) {
      if (typeof row.id !== "string") continue;
      const replacement = randomUUID();
      idMaps[table].set(row.id, replacement);
      globalIdMap.set(row.id, replacement);
    }
  }

  const rows = Object.fromEntries(
    CASE_BUNDLE_TABLES.map((table) => {
      const foreignKeys = new Map(
        schema[table].foreignKeys
          .filter((foreignKey) => isTableName(foreignKey.table))
          .map((foreignKey) => [foreignKey.from, foreignKey.table as TableName]),
      );
      const spec = tableSpecs.find((candidate) => candidate.name === table);
      const deferred = spec && "deferred" in spec ? spec.deferred : undefined;

      return [
        table,
        bundle.tables[table].map((sourceRow) => {
          const row = { ...sourceRow };
          if (typeof sourceRow.id === "string") {
            row.id = requireMappedId(idMaps[table], sourceRow.id, table, "id");
          }
          for (const [column, parentTable] of foreignKeys) {
            const value = sourceRow[column];
            if (value === null) continue;
            if (column === deferred) {
              row[column] = null;
              continue;
            }
            row[column] = requireMappedId(
              idMaps[parentTable],
              value as string,
              table,
              column,
            );
          }
          for (const [column, parentTable] of Object.entries(
            logicalReferences[table] ?? {},
          )) {
            const value = sourceRow[column];
            if (typeof value === "string") {
              row[column] = idMaps[parentTable].get(value) ?? value;
            }
          }
          if (table === "reasoning_runs" && sourceRow.request_key !== null) {
            row.request_key = randomUUID();
          }
          for (const column of schema[table].columns) {
            if (!jsonColumns.has(`${table}.${column.name}`)) continue;
            row[column.name] = JSON.stringify(
              remapJsonValue(JSON.parse(sourceRow[column.name] as string), globalIdMap),
            );
          }
          if (table === "reasoning_run_inputs") {
            row.context_fingerprint = fingerprintReasoningContext(
              row.context_json as string,
            );
          }
          return row;
        }),
      ];
    }),
  ) as CaseBundleTables;

  return { idMaps, rows };
}

function remapJsonValue(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((child) => remapJsonValue(child, ids));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, remapJsonValue(child, ids)]),
    );
  }
  return value;
}

function insertRows(
  sqlite: Database.Database,
  table: TableName,
  rows: CaseBundleRow[],
  columns: ColumnInfo[],
) {
  if (rows.length === 0) return;
  const names = columns.map((column) => column.name);
  const statement = sqlite.prepare(
    `insert into ${quoteIdentifier(table)} (${names.map(quoteIdentifier).join(", ")}) values (${names.map(() => "?").join(", ")})`,
  );
  for (const row of rows) {
    statement.run(...names.map((name) => row[name]));
  }
}

function restoreDeferredReferences(
  sqlite: Database.Database,
  table: TableName,
  column: string,
  sourceRows: CaseBundleRow[],
  idMaps: Record<TableName, Map<string, string>>,
  schema: SchemaInfo,
) {
  const foreignKey = schema[table].foreignKeys.find(
    (candidate) => candidate.from === column,
  );
  if (!foreignKey || !isTableName(foreignKey.table)) {
    throw new CaseBundleError(`无法恢复数据表 ${table} 的延迟引用。`);
  }
  const statement = sqlite.prepare(
    `update ${quoteIdentifier(table)} set ${quoteIdentifier(column)} = ? where id = ?`,
  );
  for (const row of sourceRows) {
    if (row[column] === null) continue;
    statement.run(
      requireMappedId(
        idMaps[foreignKey.table],
        row[column] as string,
        table,
        column,
      ),
      requireMappedId(idMaps[table], row.id as string, table, "id"),
    );
  }
}

function requireMappedId(
  map: Map<string, string>,
  value: string,
  table: TableName,
  column: string,
) {
  const mapped = map.get(value);
  if (!mapped) {
    throw new CaseBundleError(`数据表 ${table} 的 ${column} 无法重建引用。`);
  }
  return mapped;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new CaseBundleError(`${label}的字段与当前版本不匹配。`);
  }
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTableName(value: string): value is TableName {
  return CASE_BUNDLE_TABLES.includes(value as TableName);
}
