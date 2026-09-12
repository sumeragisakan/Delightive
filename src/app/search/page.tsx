import Link from "next/link";

import { getSearchWorkspace } from "../data";
import {
  buildSearchUrl,
  type SearchFilters,
  type SearchHit,
} from "@/db/services/search-service";
import type { SearchEntityType, SearchLayer } from "@/db/schema";

const entityOptions: Array<{ label: string; value: SearchEntityType }> = [
  { label: "案件", value: "case" },
  { label: "人物", value: "person" },
  { label: "地点", value: "location" },
  { label: "事件", value: "event" },
  { label: "来源", value: "source" },
  { label: "推理路线", value: "branch" },
  { label: "事实 / 推论", value: "claim" },
  { label: "调查事项", value: "investigation" },
  { label: "AI 运行", value: "ai_run" },
  { label: "AI 建议", value: "ai_suggestion" },
];

const layerOptions: Array<{ label: string; value: SearchLayer }> = [
  { label: "固定事实", value: "fixed" },
  { label: "可信推理", value: "trusted" },
  { label: "草稿推理", value: "draft" },
];

const statusOptions = [
  ["active", "使用中"],
  ["archived", "已归档"],
  ["draft", "草稿"],
  ["accepted", "已采纳"],
  ["rejected", "已拒绝"],
  ["needs_review", "待复核"],
  ["superseded", "已取代"],
  ["pending", "待处理"],
  ["in_progress", "处理中"],
  ["resolved", "已解决"],
  ["unresolved", "未解决"],
  ["running", "运行中"],
  ["completed", "已完成"],
  ["failed", "失败"],
  ["interrupted", "已中断"],
  ["dismissed", "已忽略"],
  ["invalid", "无效"],
] as const;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { branches, cases, results } = await getSearchWorkspace(await searchParams);
  const { filters, hits, pageCount, total } = results;

  return (
    <main className="min-h-screen px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-[96rem] overflow-hidden rounded-[1.75rem] border border-black/10 bg-[var(--paper)] shadow-[0_30px_90px_rgba(20,25,30,0.16)]">
        <header className="case-header px-6 py-5 sm:px-8 lg:px-10">
          <Link className="flex items-center gap-3" href="/">
            <span className="brand-mark" aria-hidden="true">D</span>
            <div>
              <p className="text-lg font-semibold tracking-[-0.025em] text-white">Delightive</p>
              <p className="text-xs tracking-[0.16em] text-white/55">GLOBAL SEARCH</p>
            </div>
          </Link>
          <Link className="text-sm font-semibold text-white/75 hover:text-white" href="/">
            返回案件大厅
          </Link>
        </header>

        <section className="border-b border-[var(--line)] px-6 py-8 sm:px-8 lg:px-10 lg:py-10">
          <p className="eyebrow">跨案件检索</p>
          <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">寻找一条线索</h1>
              <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
                同时检索人物别名、事件、来源、事实、推论、调查事项和 AI 结果；每条结果都可返回原始记录。
              </p>
            </div>
            <p className="font-mono text-sm text-[var(--muted)]">{total} 条匹配记录</p>
          </div>
        </section>

        <div className="grid lg:grid-cols-[22rem_minmax(0,1fr)]">
          <aside className="border-b border-[var(--line)] bg-[var(--paper-deep)] px-6 py-8 lg:border-b-0 lg:border-r lg:px-7">
            <SearchForm branches={branches} cases={cases} filters={filters} />
          </aside>
          <section className="min-w-0 px-6 py-8 sm:px-8 lg:px-10">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-5">
              <div>
                <p className="text-sm font-semibold">
                  {filters.query ? `“${filters.query}” 的结果` : "最近更新的全部记录"}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {results.mode === "substring"
                    ? "短词精确包含匹配"
                    : results.mode === "full_text"
                      ? "全文相关度匹配"
                      : "未输入关键词，按更新时间浏览"}
                </p>
              </div>
              {(filters.query || hasFilters(filters)) && (
                <Link className="text-button" href="/search">清除全部条件</Link>
              )}
            </div>

            {hits.length > 0 ? (
              <div className="space-y-3">
                {hits.map((hit) => <SearchResultCard hit={hit} key={`${hit.entityType}:${hit.entityId}`} />)}
              </div>
            ) : (
              <div className="empty-dossier">
                <span className="empty-dossier-number">00</span>
                <div>
                  <h2 className="text-xl font-semibold">没有找到匹配记录</h2>
                  <p className="mt-2 leading-7 text-[var(--muted)]">
                    试着减少筛选条件、改用更短的关键词，或包含已归档内容。
                  </p>
                </div>
              </div>
            )}

            {pageCount > 1 && <Pagination filters={filters} pageCount={pageCount} />}
          </section>
        </div>
      </div>
    </main>
  );
}

function SearchForm({ branches, cases, filters }: {
  branches: Array<{ id: string; name: string; status: "active" | "archived" }>;
  cases: Array<{ id: string; title: string; status: "active" | "archived" }>;
  filters: SearchFilters;
}) {
  return (
    <form className="space-y-6" method="get">
      <div>
        <label className="mb-2 block text-sm font-semibold" htmlFor="global-search">关键词</label>
        <input
          autoFocus
          className="w-full rounded-xl border border-[var(--line)] bg-white/80 px-3.5 py-3 text-[0.95rem] outline-none transition placeholder:text-[var(--muted)]/60 focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)]"
          defaultValue={filters.query}
          id="global-search"
          maxLength={160}
          name="q"
          placeholder="姓名、别名、线索、内容……"
          type="search"
        />
      </div>

      <FilterSelect defaultValue={filters.caseId ?? ""} label="案件" name="case">
        <option value="">全部案件</option>
        {cases.map((caseFile) => (
          <option key={caseFile.id} value={caseFile.id}>
            {caseFile.title}{caseFile.status === "archived" ? "（已归档）" : ""}
          </option>
        ))}
      </FilterSelect>

      {filters.caseId && branches.length > 0 && (
        <FilterSelect defaultValue={filters.branchId ?? ""} label="推理路线" name="branch">
          <option value="">全部路线</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}{branch.status === "archived" ? "（已归档）" : ""}
            </option>
          ))}
        </FilterSelect>
      )}

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">记录类型</legend>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {entityOptions.map((option) => (
            <FilterCheckbox checked={filters.types.includes(option.value)} key={option.value} label={option.label} name="type" value={option.value} />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">推理层级</legend>
        <div className="space-y-2">
          {layerOptions.map((option) => (
            <FilterCheckbox checked={filters.layers.includes(option.value)} key={option.value} label={option.label} name="layer" value={option.value} />
          ))}
        </div>
      </fieldset>

      <FilterSelect defaultValue={filters.status ?? ""} label="状态" name="status">
        <option value="">全部状态</option>
        {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </FilterSelect>

      <FilterSelect defaultValue={filters.createdBy ?? ""} label="创建者" name="author">
        <option value="">全部创建者</option>
        <option value="user">用户</option>
        <option value="ai">AI</option>
      </FilterSelect>

      <FilterSelect defaultValue={filters.sort} label="排序" name="sort">
        <option value="relevance">相关度优先</option>
        <option value="updated">最近更新优先</option>
      </FilterSelect>

      <FilterCheckbox checked={filters.includeArchived} label="包含已归档记录" name="archived" value="1" />

      <div className="flex gap-2 pt-1">
        <button className="primary-button flex-1" type="submit">应用搜索</button>
        <Link className="secondary-button" href="/search">重置</Link>
      </div>
    </form>
  );
}

function FilterSelect({ children, defaultValue, label, name }: {
  children: React.ReactNode;
  defaultValue: string;
  label: string;
  name: string;
}) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <select className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white/80 px-3.5 py-3 font-normal outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)]" defaultValue={defaultValue} name={name}>
        {children}
      </select>
    </label>
  );
}

function FilterCheckbox({ checked, label, name, value }: {
  checked: boolean;
  label: string;
  name: string;
  value: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
      <input className="h-4 w-4 accent-[var(--accent)]" defaultChecked={checked} name={name} type="checkbox" value={value} />
      {label}
    </label>
  );
}

function SearchResultCard({ hit }: { hit: SearchHit }) {
  return (
    <Link
      className="group block rounded-2xl border border-[var(--line)] bg-white/55 p-5 transition hover:-translate-y-0.5 hover:border-[var(--accent)]/45 hover:bg-white hover:shadow-[0_14px_35px_rgba(30,35,40,0.08)]"
      href={hit.href}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="record-badge">{entityLabel(hit.entityType)}</span>
            {hit.layer && <span className="record-badge">{layerLabel(hit.layer)}</span>}
            {hit.archived && <span className="record-badge">已归档</span>}
            {hit.createdBy && <span className="text-xs text-[var(--muted)]">{hit.createdBy === "ai" ? "AI" : "用户"}</span>}
          </div>
          <h2 className="mt-3 break-words text-lg font-semibold tracking-[-0.02em] group-hover:text-[var(--accent)]">{hit.title}</h2>
        </div>
        <time className="shrink-0 font-mono text-xs text-[var(--muted)]" dateTime={hit.updatedAt.toISOString()}>
          {formatDate(hit.updatedAt)}
        </time>
      </div>
      <p className="mt-3 break-words text-sm leading-6 text-[var(--muted)]">{hit.excerpt}</p>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--line)] pt-3 text-xs text-[var(--muted)]">
        <span>{hit.caseTitle}{hit.caseStatus === "archived" ? " · 已归档案件" : ""}</span>
        {hit.branchName && <span>路线：{hit.branchName}</span>}
        <span>状态：{statusLabel(hit.status)}</span>
        <span className="font-mono">{hit.entityId.slice(0, 8)}</span>
      </div>
    </Link>
  );
}

function Pagination({ filters, pageCount }: { filters: SearchFilters; pageCount: number }) {
  return (
    <nav aria-label="搜索结果分页" className="mt-8 flex items-center justify-between border-t border-[var(--line)] pt-5">
      {filters.page > 1 ? <Link className="secondary-button" href={buildSearchUrl(filters, filters.page - 1)}>← 上一页</Link> : <span />}
      <span className="text-sm text-[var(--muted)]">第 {filters.page} / {pageCount} 页</span>
      {filters.page < pageCount ? <Link className="secondary-button" href={buildSearchUrl(filters, filters.page + 1)}>下一页 →</Link> : <span />}
    </nav>
  );
}

function hasFilters(filters: SearchFilters) {
  return Boolean(filters.caseId || filters.branchId || filters.types.length || filters.layers.length || filters.status || filters.createdBy || filters.includeArchived || filters.sort === "updated");
}

function entityLabel(type: SearchEntityType) {
  return entityOptions.find((option) => option.value === type)?.label ?? type;
}

function layerLabel(layer: SearchLayer) {
  return layerOptions.find((option) => option.value === layer)?.label ?? layer;
}

function statusLabel(status: string) {
  return statusOptions.find(([value]) => value === status)?.[1] ?? status;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(value);
}
