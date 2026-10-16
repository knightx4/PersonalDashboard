import { Card } from '@/components/ui/card';
import { StatusGlyph } from '@/components/ui/status-glyph';
import type { StatusGlyph as GlyphName } from '@/lib/status-glyphs';
import { Disclosure } from '@/components/ui/disclosure';
import Link from '@/components/ui/link';
import { SectionLabel } from '@/components/ui/section-heading';
import { whenDay } from '@/lib/core/when';
import type { CellStatus } from '@/lib/learn/levels/model';
import { NEXT_WORDS, STATUS_WORDS, VERDICT_WORDS, type LevelRow, type TopicStanding } from '@/lib/learn/levels/standing';
import { RewordChecks } from './reword-checks';

/**
 * The ten levels of an approved topic with where you stand on each (plan
 * #2138.3): its status, the evidence behind it with the quotes, what it
 * needs and what needs it, and the cell asked next. Every status is computed
 * on read by lib/learn/levels/model.ts; this draws it.
 *
 * `open` is how the gallery draws the parts that open on a press: the quote
 * list of one level, or the editor on one level.
 */

/** A hexagon filled by how held the level is; the word beside it says it. */
export const STATUS_GLYPH: Record<CellStatus, GlyphName> = {
  shown: 'full',
  implied: 'dashed',
  declared: 'check',
  missed: 'cross',
  open: 'empty',
};

export type LadderOpen = { quotes?: number; edit?: number };

function Evidence({
  row,
  open,
  timezone,
  now,
}: {
  row: LevelRow;
  open: boolean;
  timezone: string;
  now: number;
}) {
  if (row.evidence.length === 0) return null;
  const n = row.evidence.length;
  return (
    <Disclosure title="Evidence" meta={n === 1 ? '1 answer' : `${n} answers`} defaultOpen={open} className="mt-1.5">
      <ul className="space-y-2">
        {row.evidence.map((e) => (
          <li key={`${e.observedAt}:${e.verdict}`} className="text-small">
            <p className="text-ink-muted">
              <span className="font-medium text-ink">{VERDICT_WORDS[e.verdict]}</span>
              {', '}
              {whenDay(e.observedAt, { timeZone: timezone, now })}
              {e.beforeRewording && ', before you reworded this level'}
            </p>
            {e.quote && (
              <blockquote className="mt-0.5 border-l-2 border-border pl-3 text-ui text-ink">“{e.quote}”</blockquote>
            )}
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

function Links({ row }: { row: LevelRow }) {
  if (row.needs.length === 0 && row.neededBy.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-0.5">
      {row.needs.map((link) => (
        <li key={`needs:${link.topicId}:${link.level}`} className="text-small text-ink-muted">
          Needs{' '}
          <Link href={`/learn/topics/${link.topicId}`} className="text-ink hover:text-accent">
            {link.topicName} {link.level}
          </Link>
          {link.why && <span>: {link.why}</span>}
        </li>
      ))}
      {row.neededBy.map((link) => (
        <li key={`by:${link.topicId}:${link.fromLevel}`} className="text-small text-ink-muted">
          Needed by{' '}
          <Link href={`/learn/topics/${link.topicId}`} className="text-ink hover:text-accent">
            {link.topicName} {link.fromLevel}
          </Link>
          {link.why && <span>: {link.why}</span>}
        </li>
      ))}
    </ul>
  );
}

export function LadderView({
  topicId,
  standing,
  open,
  timezone,
  now,
}: {
  topicId: string;
  standing: TopicStanding;
  open?: LadderOpen;
  timezone: string;
  now: number;
}) {
  return (
    <section aria-labelledby="levels-heading">
      <h2 id="levels-heading" className="px-1 text-ui font-semibold text-ink">
        The levels
      </h2>
      <div className="mb-2" />
      <Card padding="none">
        {standing.untouched && (
          <p className="card-pad-x border-b border-border py-3 text-small text-ink-muted">
            Nothing shown yet. Practice Flow places you with its first question; until then every level is open.
          </p>
        )}
        <ol className="divide-y divide-border">
          {standing.rows.map((row) => (
            <li key={row.cellId} className="card-pad-x relative py-3" aria-label={`Level ${row.level}, ${STATUS_WORDS[row.status]}`}>
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 pr-12">
                <span className="tabular text-ui font-semibold text-ink">{row.level}</span>
                <SectionLabel as="span">{row.band}</SectionLabel>
                <span className="inline-flex items-center gap-1 text-small text-ink">
                  <StatusGlyph glyph={STATUS_GLYPH[row.status]} size={12} />
                  {STATUS_WORDS[row.status]}
                </span>
                {row.inDoubt && (
                  <span className="inline-flex items-center gap-1 text-small text-ink-muted">
                    <StatusGlyph glyph="question" size={12} />
                    In doubt
                  </span>
                )}
                {row.rewrittenAt && (
                  <span className="text-small text-ink-muted">
                    reworded {whenDay(row.rewrittenAt, { timeZone: timezone, now }).toLowerCase()}
                  </span>
                )}
              </p>
              <p className="text-small text-ink-muted">You can {row.can}</p>
              {row.next && <p className="mt-0.5 text-small font-medium text-accent">{NEXT_WORDS[row.next]}</p>}
              <RewordChecks
                topicId={topicId}
                cellId={row.cellId}
                level={row.level}
                checks={row.checks}
                defaultEditing={open?.edit === row.level}
              />
              <Evidence row={row} open={open?.quotes === row.level} timezone={timezone} now={now} />
              <Links row={row} />
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}
