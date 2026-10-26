import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import Link from '@/components/ui/link';
import { StatusGlyph } from '@/components/ui/status-glyph';
import type { StatusGlyph as GlyphName } from '@/lib/status-glyphs';
import type { RunCell, RunSummary } from '@/lib/learn/levels/run';

/**
 * The end of a practice run: every level that moved while it lasted (plan
 * #2138.6; docs/LEARN-LEVELS-SPEC.md, "Screens"). The deck's last item, shown
 * when you press End run or when there is nothing left to ask.
 *
 * Grouped the way the answer screen marks a level, with the same glyphs:
 * shown by your words, settled beneath them, not there yet. Each group is the
 * list itself, not a count, because what moved is the point of the screen.
 */

/** Only Not yet carries a line, because it says what happens next; the other names need no gloss. */
const GROUPS: Array<{ key: 'shown' | 'implied' | 'missed'; label: string; line?: string; glyph: GlyphName }> = [
  { key: 'shown', label: 'Shown', glyph: 'full' },
  { key: 'implied', label: 'Held under what you showed', glyph: 'half' },
  { key: 'missed', label: 'Not yet', line: 'These come back before anything new.', glyph: 'empty' },
];

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The sentence at the top of the summary. */
export function runHeadline(summary: RunSummary, nothingLeft: boolean): string {
  const left = nothingLeft ? ' There is nothing left to ask for now.' : '';
  if (summary.answered === 0) return `No questions answered in this run.${left}`;
  const moved = summary.shown.length + summary.implied.length;
  const answered = plural(summary.answered, 'answer', 'answers');
  return moved === 0
    ? `${answered}, and no level is held that was not before.${left}`
    : `${answered} moved ${plural(moved, 'level', 'levels')}.${left}`;
}

function Group({ cells, label, line, glyph }: { cells: RunCell[]; label: string; line?: string; glyph: GlyphName }) {
  return (
    <li className="px-4 py-3">
      <p className="flex items-center gap-1.5 text-ui font-medium text-ink">
        <StatusGlyph glyph={glyph} size={12} className="text-ink" />
        {label}
        <span className="font-normal text-ink-muted">· {cells.length}</span>
      </p>
      {line && <p className="mt-0.5 text-small text-ink-muted">{line}</p>}
      <ul className="mt-2 space-y-1">
        {cells.map((c) => (
          <li key={c.cellId} className="text-ui text-ink">
            {c.topicName}, level {c.level}
          </li>
        ))}
      </ul>
    </li>
  );
}

export function RunSummaryView({
  summary,
  againHref,
  nothingLeft = false,
  offer,
  title = 'End of this run',
  headline,
  againLabel = 'Start another run',
}: {
  summary: RunSummary;
  /** A new run. */
  againHref: string;
  /** The run ended because there was nothing left to ask, not on a press. */
  nothingLeft?: boolean;
  /** The lens offered for a vault theme the missed levels point to (plan #2138.14). */
  offer?: ReactNode;
  /** The small line over the headline; a learning session's end says session (plan #2546.3). */
  title?: string;
  /** The sentence in place of `runHeadline`'s, for an end that counts more than questions. */
  headline?: string;
  againLabel?: string;
}) {
  const groups = GROUPS.filter((g) => summary[g.key].length > 0);
  return (
    <div data-deck-item className="pb-[calc(var(--dock-h)+env(safe-area-inset-bottom))] lg:pb-0">
      <Card padding="standard">
        <p className="text-small text-ink-muted">{title}</p>
        <p className="mt-1 text-body font-semibold text-ink">{headline ?? runHeadline(summary, nothingLeft)}</p>
      </Card>
      {(groups.length > 0 || summary.doubted.length > 0) && (
        <Card padding="none" className="mt-3 overflow-hidden">
          <ul className="divide-y divide-border">
            {groups.map((g) => (
              <Group key={g.key} cells={summary[g.key]} label={g.label} line={g.line} glyph={g.glyph} />
            ))}
            {summary.doubted.map((link) => (
              <li
                key={`${link.from.topicName}${link.from.level}>${link.to.topicName}${link.to.level}`}
                className="px-4 py-3 text-small text-ink-muted"
              >
                Your answers disagree about whether {link.from.topicName}, level {link.from.level} needs{' '}
                {link.to.topicName}, level {link.to.level}, so that link is up for review.
              </li>
            ))}
          </ul>
        </Card>
      )}
      {offer}
      {!nothingLeft && (
        <Card
          padding="none"
          className="sticky bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom))] z-over-link mt-3 flex items-center justify-end gap-2 px-3 py-2 lg:static"
        >
          <Link href={againHref} className={buttonVariants({ size: 'lg' })}>
            {againLabel}
            <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
          </Link>
        </Card>
      )}
    </div>
  );
}
