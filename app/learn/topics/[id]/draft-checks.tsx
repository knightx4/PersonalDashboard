'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { COVERAGE_FLAG, OVERLAP_FLAG, type DraftingRecord } from '@/lib/learn/levels/draft-sources';
import { markTarget, type Provenance } from '@/lib/learn/levels/provenance';
import type { RowCitation } from '@/lib/learn/levels/store';
import { markRowsPersonal, type MarkState } from './actions';

/**
 * The five checks shown above a held draft's levels (plan
 * #2138.11): coverage of the sources given, structure, how far the two
 * drafts agree, which rows name a source, and a short checklist a
 * practitioner would read the top levels against.
 *
 * Coverage, structure, overlap and the checklist were worked out when the
 * topic was drafted and are kept on it; provenance is read from the rows, so
 * a row marked personal counts at once.
 *
 * Marking is one hidden form, `MARK_FORM`, that each row's button sends by
 * id, since the rows sit inside the levels form and a form cannot hold
 * another.
 */

export const MARK_FORM = 'mark-personal';

/** The form every Mark personal button on the page sends. */
export function MarkPersonalForm({ topicId }: { topicId: string }) {
  const [state, mark] = useActionState<MarkState, FormData>(markRowsPersonal, {});
  return (
    <form id={MARK_FORM} action={mark} aria-label="Mark rows personal">
      <input type="hidden" name="topicId" value={topicId} />
      {state.error && (
        <p role="alert" className="px-1 text-small text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}

function MarkButton({ target, children }: { target: string; children: React.ReactNode }) {
  return (
    <Button type="submit" form={MARK_FORM} name="target" value={target} size="xs" variant="link">
      {children}
    </Button>
  );
}

/**
 * Where one row came from, under it: the source in words, or a flag with
 * the press that marks it personal.
 */
export function RowSource({
  kind,
  id,
  citation,
}: {
  kind: 'topic' | 'cell' | 'link';
  id: string;
  citation: Partial<RowCitation>;
}) {
  if (citation.source) {
    return (
      <p className="mt-1 line-clamp-2 text-small text-ink-muted">
        From {citation.source}
        {citation.canonicality && <span> · {citation.canonicality}</span>}
      </p>
    );
  }
  if (citation.canonicality === 'personal') {
    return (
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-small text-ink-muted">
        <span>Personal: yours, with no source</span>
        <MarkButton target={markTarget([{ kind, id }], true)}>Undo</MarkButton>
      </p>
    );
  }
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-small">
      <Chip tone="caution" size="sm">
        No source
      </Chip>
      <MarkButton target={markTarget([{ kind, id }])}>Mark personal</MarkButton>
    </p>
  );
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

type Verdict = 'pass' | 'flag' | 'read';

function CheckRow({
  name,
  verdict,
  finding,
  children,
}: {
  name: string;
  verdict: Verdict;
  finding: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="card-pad-x py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-ui font-semibold text-ink">{name}</h3>
        {verdict === 'flag' ? (
          <Chip tone="caution" size="sm">
            Look at this
          </Chip>
        ) : verdict === 'pass' ? (
          <Chip tone="positive" size="sm">
            Holds
          </Chip>
        ) : null}
      </div>
      <p className="mt-0.5 text-ui text-ink">{finding}</p>
      {children}
    </li>
  );
}

function MarkAllButton({ target, count }: { target: string; count: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" form={MARK_FORM} name="target" value={target} size="sm" variant="secondary" pending={pending}>
      {count === 1 ? 'Mark it personal' : count === 2 ? 'Mark both personal' : `Mark all ${count} personal`}
    </Button>
  );
}

function levelSpan(levels: readonly number[]): string {
  if (levels.length === 1) return `level ${levels[0]}`;
  return `levels ${levels[0]} to ${levels[levels.length - 1]}`;
}

/** The five checks, or provenance alone for a topic drafted before sources. */
export function DraftChecks({ drafting, provenance }: { drafting: DraftingRecord | null; provenance: Provenance }) {
  const uncited = provenance.uncited.length;
  const provenanceRow = (
    <CheckRow
      name="Provenance"
      verdict={uncited === 0 ? 'pass' : 'flag'}
      finding={
        uncited === 0
          ? `Every row names a source${provenance.personal > 0 ? ` or is marked personal (${provenance.personal})` : ''}.`
          : `${provenance.cited} of ${provenance.total} rows name a source. ${uncited === 1 ? 'One does not' : `${uncited} do not`}, and Dash marks each personal when it approves the draft.`
      }
    >
      {uncited > 0 && (
        <div className="mt-1.5 space-y-2">
          <p className="text-small text-ink-muted">
            No source: {provenance.uncited.map((row) => row.label).join(', ')}.
          </p>
          <MarkAllButton target={markTarget(provenance.uncited)} count={uncited} />
        </div>
      )}
    </CheckRow>
  );

  if (!drafting) {
    return (
      <section aria-labelledby="checks-heading">
        <ChecksHeading />
        <Card padding="none">
          <CardNote>Drafted before sources were taken, so provenance is the one check it has.</CardNote>
          <ul className="divide-y divide-border">{provenanceRow}</ul>
        </Card>
      </section>
    );
  }

  const { coverage, structure } = drafting;
  const withLines = coverage.sources.filter((s) => s.total > 0);
  const covered = withLines.reduce((n, s) => n + s.covered, 0);
  const inScope = withLines.reduce((n, s) => n + s.inScope, 0);

  return (
    <section aria-labelledby="checks-heading">
      <ChecksHeading />
      <Card padding="none">
        <CardNote>Read these before the levels.</CardNote>
        <ul className="divide-y divide-border">
          <CheckRow
            name="Coverage"
            verdict={coverage.share === null ? 'flag' : coverage.share >= COVERAGE_FLAG ? 'pass' : 'flag'}
            finding={
              drafting.sources.length === 0
                ? 'No sources were given, so nothing could be covered.'
                : coverage.share === null
                  ? 'The sources were named without lines, so coverage could not be counted.'
                  : `${percent(coverage.share)} of the source lines that belong here are cited: ${covered} of ${inScope}.`
            }
          >
            {drafting.sources.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-small text-ink-muted">
                {coverage.sources.map((source) => (
                  <li key={source.id} className="min-w-0">
                    <span className="tabular">{source.id}</span> {source.label}
                    {source.total > 0 && (
                      <span className="tabular">
                        : {source.covered} of {source.inScope}
                        {source.inScope < source.total && `, ${source.total - source.inScope} left to neighbours`}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {coverage.uncovered.length > 0 && (
              <p className="mt-1 text-small text-ink-muted">
                Not covered: {coverage.uncovered.map((line) => `“${line.replace(/^\S+\s/, '')}”`).join(', ')}.
              </p>
            )}
          </CheckRow>

          <CheckRow
            name="Structure"
            verdict={!structure.acyclic || structure.offPath.length > 0 || drafting.performances.length === 0 ? 'flag' : 'pass'}
            finding={
              <>
                {structure.acyclic ? 'No requirement loops back on itself. ' : 'A requirement loops back on itself. '}
                {drafting.performances.length === 0
                  ? 'No performances were given, so no level could be traced to one.'
                  : structure.offPath.length === 0
                    ? 'Every level leads to a performance.'
                    : `${levelSpan(structure.offPath).replace(/^l/, 'L')} ${structure.offPath.length === 1 ? 'leads' : 'lead'} to no performance.`}
              </>
            }
          >
            {(structure.served.length > 0 || structure.unserved.length > 0) && (
              <ul className="mt-1.5 space-y-0.5 text-small text-ink-muted">
                {structure.served.map((s) => (
                  <li key={s.performance}>
                    {s.performance}: <span className="tabular">level {s.level}</span>
                  </li>
                ))}
                {structure.unserved.map((p) => (
                  <li key={p}>{p}: not served by this topic</li>
                ))}
              </ul>
            )}
          </CheckRow>

          <CheckRow
            name="Stability"
            verdict={drafting.overlap === null || drafting.overlap < OVERLAP_FLAG ? 'flag' : 'pass'}
            finding={
              drafting.overlap === null
                ? (drafting.overlapMissing ?? 'Only one draft came back.')
                : `The two drafts overlap ${percent(drafting.overlap)}, by the words of each level, the topics linked and the lines cited.`
            }
          />

          {provenanceRow}

          <CheckRow
            name="Practitioner checklist"
            verdict="read"
            finding={
              drafting.checklist.length === 0
                ? 'The draft came back with no checklist.'
                : 'Read the top levels against these.'
            }
          >
            {drafting.checklist.length > 0 && (
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-ui text-ink">
                {drafting.checklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            )}
          </CheckRow>
        </ul>
      </Card>
    </section>
  );
}

function ChecksHeading() {
  return (
    <h2 id="checks-heading" className="mb-2 px-1 text-ui font-semibold text-ink">
      Checks
    </h2>
  );
}

/** A section's one line of instruction, inside its card rather than on the page (taste: no bare text). */
export function CardNote({ children }: { children: React.ReactNode }) {
  return <p className="card-pad-x border-b border-border py-2 text-small text-ink-muted">{children}</p>;
}
