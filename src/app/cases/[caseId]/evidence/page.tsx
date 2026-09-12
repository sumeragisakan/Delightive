import { notFound } from "next/navigation";

import { CaseWorkspaceFrame } from "../../../components/case-workspace-frame";
import {
  EvidenceClaimArchiveButton,
  EvidenceClaimCreateForm,
  EvidenceClaimEditor,
  EvidenceLinksManager,
  SourceCreateForm,
  SourceEditor,
} from "../../../components/evidence-forms";
import { getEvidenceWorkspace } from "../../../data";
import type {
  EvidenceClaim,
  EvidenceSource,
} from "@/db/repositories/evidence-repository";
import type { TimelineEvent } from "@/db/repositories/event-repository";

export default async function EvidencePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const { caseFile, claims, events, locations, people, sources } =
    await getEvidenceWorkspace(caseId);

  if (!caseFile) {
    notFound();
  }

  const activeClaims = claims.filter((claim) => claim.archivedAt === null);
  const acceptedFacts = activeClaims.filter(
    (claim) => claim.kind === "fact" && claim.status === "accepted",
  );
  const statements = activeClaims.filter((claim) => claim.kind === "statement");
  const reviewQueue = activeClaims.filter(
    (claim) => claim.kind === "fact" && claim.status !== "accepted",
  );
  const archivedClaims = claims.filter((claim) => claim.archivedAt !== null);
  const activeSources = sources.filter((source) => source.archivedAt === null);
  const archivedSources = sources.filter((source) => source.archivedAt !== null);

  return (
    <CaseWorkspaceFrame
      activeModule="evidence"
      aside={
        <div className="space-y-7 lg:sticky lg:top-8">
          <section>
            <p className="eyebrow">来源簿</p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]">
              添加来源
            </h2>
            <p className="mb-6 mt-2 text-sm leading-6 text-[var(--muted)]">
              保存章节、证词与原文摘录，事实才能保持可追溯。
            </p>
            <SourceCreateForm caseId={caseId} />
          </section>

          <section className="border-t border-[var(--line)] pt-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="font-semibold">当前来源</h3>
              <span className="record-badge">{activeSources.length}</span>
            </div>
            {activeSources.length > 0 ? (
              <div className="space-y-3">
                {activeSources.map((source) => (
                  <SourceEditor caseId={caseId} key={source.id} source={source} />
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-[var(--line)] p-4 text-sm leading-6 text-[var(--muted)]">
                还没有来源。草稿可以先记录，但确认事实前需要关联出处。
              </p>
            )}
            {archivedSources.length > 0 && (
              <details className="mt-4 border-t border-[var(--line)] pt-4">
                <summary className="cursor-pointer text-sm font-semibold text-[var(--muted)]">
                  已归档来源 · {archivedSources.length}
                </summary>
                <div className="mt-3 space-y-3">
                  {archivedSources.map((source) => (
                    <SourceEditor
                      caseId={caseId}
                      key={source.id}
                      source={source}
                    />
                  ))}
                </div>
              </details>
            )}
          </section>
        </div>
      }
      caseFile={caseFile}
    >
      <div className="flex flex-col gap-3 border-b border-[var(--line)] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">事实与来源</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
            固定事实层
          </h2>
        </div>
        <p className="max-w-lg text-sm leading-6 text-[var(--muted)]">
          事实描述来源能够支持的内容；人物陈述只表示“某人这样说过”。
        </p>
      </div>

      <details
        className="evidence-composer mt-6"
        open={activeClaims.length === 0}
      >
        <summary className="cursor-pointer list-none marker:hidden">
          <span className="font-semibold">记录事实或人物陈述</span>
          <span className="ml-2 text-sm text-[var(--muted)]">
            草稿允许暂时没有来源
          </span>
        </summary>
        <div className="mt-5 border-t border-[var(--line)] pt-5">
          <EvidenceClaimCreateForm
            caseId={caseId}
            events={events}
            locations={locations}
            people={people}
            sources={sources}
          />
        </div>
      </details>

      {activeClaims.length > 0 ? (
        <div className="mt-8 space-y-10">
          <EvidenceGroup
            caseId={caseId}
            claims={acceptedFacts}
            events={events}
            label="已确认事实"
            locations={locations}
            people={people}
            sources={sources}
          />
          <EvidenceGroup
            caseId={caseId}
            claims={statements}
            events={events}
            label="人物陈述"
            locations={locations}
            people={people}
            sources={sources}
          />
          <EvidenceGroup
            caseId={caseId}
            claims={reviewQueue}
            events={events}
            label="草稿与待复核"
            locations={locations}
            people={people}
            sources={sources}
          />
        </div>
      ) : (
        <div className="empty-dossier mt-6">
          <span className="empty-dossier-number">00</span>
          <div>
            <h3 className="text-xl font-semibold">固定事实层还是空的</h3>
            <p className="mt-2 max-w-lg leading-7 text-[var(--muted)]">
              从一条原文来源开始，再写下它能够直接支持的最小事实。
            </p>
          </div>
        </div>
      )}

      {archivedClaims.length > 0 && (
        <details className="mt-10 border-t border-[var(--line)] pt-6">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--muted)]">
            已归档内容 · {archivedClaims.length}
          </summary>
          <div className="mt-4 grid gap-3">
            {archivedClaims.map((claim) => (
              <EvidenceSummaryCard
                caseId={caseId}
                claim={claim}
                events={events}
                key={claim.id}
                locations={locations}
                people={people}
                sources={sources}
              />
            ))}
          </div>
        </details>
      )}
    </CaseWorkspaceFrame>
  );
}

function EvidenceGroup({
  caseId,
  claims,
  events,
  label,
  locations,
  people,
  sources,
}: {
  caseId: string;
  claims: EvidenceClaim[];
  events: TimelineEvent[];
  label: string;
  locations: LocationOption[];
  people: PersonOption[];
  sources: EvidenceSource[];
}) {
  if (claims.length === 0) {
    return null;
  }

  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-[0.17em] text-[var(--accent)]">
          {label}
        </h3>
        <span className="h-px flex-1 bg-[var(--line)]" />
        <span className="text-xs text-[var(--muted)]">{claims.length} 条</span>
      </div>
      <div className="grid gap-4">
        {claims.map((claim) => (
          <EvidenceSummaryCard
            caseId={caseId}
            claim={claim}
            events={events}
            key={claim.id}
            locations={locations}
            people={people}
            sources={sources}
          />
        ))}
      </div>
    </section>
  );
}

function EvidenceSummaryCard({
  caseId,
  claim,
  events,
  locations,
  people,
  sources,
}: {
  caseId: string;
  claim: EvidenceClaim;
  events: TimelineEvent[];
  locations: LocationOption[];
  people: PersonOption[];
  sources: EvidenceSource[];
}) {
  return (
    <article className="evidence-card scroll-mt-8" id={`claim-${claim.id}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`evidence-status evidence-status-${claim.status}`}>
              {statusLabels[claim.status]}
            </span>
            <span className="text-xs text-[var(--muted)]">
              {claim.kind === "fact" ? "固定事实" : "人物陈述"} · 修订 {claim.revision}
            </span>
          </div>
          <p className="mt-3 text-base leading-7">{claim.content}</p>
          {claim.speaker && (
            <p className="mt-2 text-sm text-[var(--muted)]">
              发言者：{claim.speaker.displayName}
            </p>
          )}
        </div>
        {claim.confidence !== null && (
          <span className="record-badge">可信度 {claim.confidence}%</span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
        {claim.sources.map((link) => (
          <span
            className={link.isStale ? "evidence-link evidence-link-stale" : "evidence-link"}
            key={`${link.source.id}-${link.relation}`}
          >
            来源 · {link.source.title}
            {link.isStale ? " · 待核对" : ""}
          </span>
        ))}
        {claim.events.map((link) => (
          <span
            className={link.isStale ? "evidence-link evidence-link-stale" : "evidence-link"}
            key={`${link.event.id}-${link.role}`}
          >
            事件 · {link.event.title}
          </span>
        ))}
        {claim.people.map((link) => (
          <span className="evidence-link" key={`${link.person.id}-${link.role}`}>
            人物 · {link.person.displayName}
          </span>
        ))}
        {claim.locations.map((link) => (
          <span className="evidence-link" key={`${link.location.id}-${link.role}`}>
            地点 · {link.location.name}
          </span>
        ))}
        {claim.sources.length +
          claim.events.length +
          claim.people.length +
          claim.locations.length ===
          0 && <span className="text-sm text-[var(--muted)]">尚未关联出处或对象</span>}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--muted)]">
        <span>下游推理：{claim.downstreamClaimCount}</span>
        <span className="font-mono">CLAIM · {claim.id.slice(0, 8)}</span>
      </div>

      {claim.archivedAt ? (
        <div className="mt-4 border-t border-[var(--line)] pt-4">
          <EvidenceClaimArchiveButton
            archived
            caseId={caseId}
            claimId={claim.id}
          />
        </div>
      ) : (
        <details className="mt-5 border-t border-[var(--line)] pt-4">
          <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--accent)] marker:hidden">
            编辑内容与关联
          </summary>
          <div className="mt-5 space-y-6">
            <EvidenceClaimEditor
              caseId={caseId}
              claim={claim}
              people={people}
            />
            <div className="border-t border-[var(--line)] pt-5">
              <h4 className="mb-4 font-semibold">出处与对象</h4>
              <EvidenceLinksManager
                caseId={caseId}
                claim={claim}
                events={events}
                locations={locations}
                people={people}
                sources={sources}
              />
            </div>
            <div className="border-t border-[var(--line)] pt-5">
              <EvidenceClaimArchiveButton
                archived={false}
                caseId={caseId}
                claimId={claim.id}
              />
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                归档不会删除内容；依赖它的已接受推理会进入待复核状态。
              </p>
            </div>
          </div>
        </details>
      )}
    </article>
  );
}

type PersonOption = { displayName: string; id: string };
type LocationOption = { id: string; name: string };

const statusLabels = {
  accepted: "已确认",
  draft: "草稿",
  needs_review: "待复核",
  rejected: "已否定",
  superseded: "已取代",
} as const;
