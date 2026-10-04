import Link from 'next/link';
import { MessageSquareText } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Disclosure } from '@/components/ui/disclosure';
import { cardVariants } from '@/components/ui/card';
import { SPECS, groupSpecs, specBySlug, type SpecDoc } from '@/lib/specs/registry';
import type { SpecChange } from '@/lib/specs/changes';
import type { LatestFindings } from '@/lib/specs/findings';
import { APP_VISION, visionAnchor, type ModuleVision } from '@/lib/specs/vision';
import type { VisionReview } from '@/lib/specs/vision-review';
import type { VisionScope } from '@/lib/specs/vision';
import { ModuleVisionPanel } from './vision-view';
import { VisionEditPanel } from './vision-edit';
import { SpecChangeCard } from './spec-change-card';
import { SpecFindings } from './spec-findings';
import { cn } from '@/lib/cn';

/**
 * The specs page apart from its reads, so the surface gallery can draw it:
 * the visions and documents by workspace, and the changes waiting on you.
 */

function SpecRow({ spec, comments }: { spec: SpecDoc; comments: number }) {
  return (
    <li>
      <Link
        href={`/dev/specs/${spec.slug}`}
        className={cn(
          cardVariants({ padding: 'dense' }),
          'block transition-colors duration-quick hover:border-border-strong',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-body font-semibold text-ink">{spec.title}</h3>
          {comments > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-caption text-ink-muted">
              <MessageSquareText className="size-3.5" strokeWidth={2} aria-hidden />
              {comments}
            </span>
          )}
        </div>
        <p className="mt-1 text-ui text-ink-muted">{spec.blurb}</p>
        <p className="mt-2 text-caption text-ink-ghost">docs/{spec.file}</p>
      </Link>
    </li>
  );
}

export function SpecsView({
  counts,
  visions,
  edits,
  changes,
  audit,
}: {
  counts: Record<string, number>;
  visions: Partial<Record<VisionScope, ModuleVision>>;
  edits: Partial<Record<VisionScope, VisionReview>>;
  changes: SpecChange[];
  audit: LatestFindings;
}) {
  const groups = groupSpecs(SPECS, counts);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Specs"
        description="The vision for the app and each workspace, and the documents behind it read from the repository. Comment on any section; tag @dash in one to ask about it."
      />

      {/* Changes Dash proposes to the specs, above the documents they change
          (plan #1506). First because they are the one thing on the page
          waiting on you; not drawn at all when nothing is. */}
      {changes.length > 0 && (
        <section aria-labelledby="spec-changes" className="space-y-2">
          <h2 id="spec-changes" className="text-body font-semibold text-ink">
            Changes to specs
            <span className="tabular ml-2 font-normal text-ink-muted">{changes.length}</span>
          </h2>
          <ul className={cn(cardVariants(), 'divide-y divide-border')}>
            {changes.map((change) => (
              <SpecChangeCard
                key={change.id}
                change={change}
                specTitle={specBySlug(change.spec)?.title ?? null}
              />
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-2">
        {groups.map((group) => (
          /*
            Open by default, and not an accordion. There are seven groups of
            one to three documents, so the whole page fits on a screen either
            way, and the fold is for putting a workspace you are not working on
            out of sight rather than for making the page fit.

            The count on the folded row is the number of documents and the
            number of comments on them, which is what decides whether a closed
            group is worth opening. A fold that hides its own count has moved
            the work rather than saved it.
          */
          <Disclosure
            key={group.module ?? 'app'}
            title={group.label}
            defaultOpen
            meta={
              <span className="flex items-center gap-3">
                <span>
                  {/* A workspace can now be here with nothing written for it,
                      and "0 documents" is a count standing in for a state. */}
                  {group.specs.length === 0
                    ? 'No documents yet'
                    : `${group.specs.length} ${group.specs.length === 1 ? 'document' : 'documents'}`}
                </span>
                {group.comments > 0 && (
                  <span className="flex items-center gap-1">
                    <MessageSquareText className="size-3.5" strokeWidth={2} aria-hidden />
                    {group.comments}
                  </span>
                )}
              </span>
            }
          >
            <div className="pt-2">
              {/* The anchor a search hit on this vision lands at (plan #1155),
                  around the vision and any edit proposed to it. */}
              <div id={visionAnchor(group.module ?? APP_VISION)} className="scroll-mt-bar">
                {/* Above the documents rather than among them, because it is the
                  layer above them. The app-wide group has one too: what the
                  app as a whole is for, which a step with no workspace is
                  briefed with. */}
                <ModuleVisionPanel
                  module={group.module ?? APP_VISION}
                  label={group.module ? group.label : 'the app'}
                  vision={visions[group.module ?? APP_VISION] ?? null}
                />

                {/* An edit the weekly review proposed, under the vision it would
                  replace, until it is accepted or dismissed (plan #1106). */}
                {edits[group.module ?? APP_VISION] && (
                  <VisionEditPanel
                    edit={edits[group.module ?? APP_VISION]!}
                    currentBody={visions[group.module ?? APP_VISION]?.body ?? null}
                    label={group.module ? group.label : 'the app'}
                  />
                )}
              </div>

              {/* A workspace with no spec has no page of its own, so what the
                  audit found about it (usually that nothing describes it) is
                  drawn here, under its vision (plan #1525). */}
              {group.module && audit.findings.some((f) => f.spec === group.module) && (
                <div className="mb-2">
                  <SpecFindings
                    auditAt={audit.auditAt}
                    findings={audit.findings.filter((f) => f.spec === group.module)}
                    headingId={`spec-findings-${group.module}`}
                  />
                </div>
              )}

              {group.specs.length > 0 && (
                <ul className="space-y-2">
                  {group.specs.map((spec) => (
                    <SpecRow key={spec.slug} spec={spec} comments={counts[spec.slug] ?? 0} />
                  ))}
                </ul>
              )}
            </div>
          </Disclosure>
        ))}
      </div>
    </div>
  );
}
