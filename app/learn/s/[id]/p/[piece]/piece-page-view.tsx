import Link, { linkVariants } from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/shell/page-header';
import type { PiecePage } from '@/lib/learn/lessons/piece-store';
import type { PracticeView } from '@/lib/learn/lessons/practice';
import type { DueReview } from '@/lib/learn/lessons/review';
import { ReviewList } from '@/app/learn/review/review-list';
import { PieceLessons, PiecePassing } from './piece-view';
import { cn } from '@/lib/cn';
import { PageColumn } from '@/components/shell/page-width';
import type { Subject as PageSubject } from '@/components/shell/page-header';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { STATUS_GLYPH } from '@/app/learn/topics/[id]/ladder-view';
import { checkCell, type PieceCellView } from '@/lib/learn/lessons/piece-cells';
import { STATUS_WORDS } from '@/lib/learn/levels/standing';

export type PiecePageProps = {
  page: PiecePage;
  practice: PracticeView | null;
  standing: { practicePassed: boolean; checkPassed: boolean };
  /** Ideas from this plan's passed pieces due for review, this piece's own left out. */
  reviews: DueReview[];
  /** The path to this page, from the page (rowSubject); the gallery passes none. */
  path?: PageSubject;
};

/** One piece of a learning goal's plan, from what its page read (plan #1602). */
export function PiecePageView({ page, practice, standing, reviews, path }: PiecePageProps) {
  const { piece, subject, unit, siblings } = page;

  return (
    <PageColumn>

      <PageHeader
        subject={path}
        title={piece.title}
        description={`Unit ${unit.ordinal}, ${unit.title} · piece ${piece.ordinal} of ${siblings.length}${
          piece.passedAt ? ' · passed' : ''
        }`}
      />

      {unit.outcome && (
        <Card padding="standard" className="mb-5">
          <p className="text-ui text-ink-muted">
            <span className="text-ink">By the end of the unit: </span>
            {unit.outcome}
          </p>
        </Card>
      )}

      <ReviewList
        reviews={reviews}
        title="First, from earlier in this track"
        description="Due for review today. A right answer brings the next question later; a miss brings it back tomorrow."
        showPlan={false}
      />

      <PieceCells cells={page.cells} />

      {page.ideas.length === 0 ? (
        <p className="mb-6 text-body text-ink-muted">
          The ideas this piece covered are no longer in the subject.
        </p>
      ) : (
        <>
          <PieceLessons subjectId={subject.id} pieceId={piece.id} ideas={page.ideas} />
          <div className="mt-6">
            <PiecePassing
              subjectId={subject.id}
              pieceId={piece.id}
              practice={practice}
              check={page.check}
              passedAt={piece.passedAt}
              practicePassed={standing.practicePassed}
              checkPassed={standing.checkPassed}
              checkOn={checkCell(page.cells)}
            />
          </div>
        </>
      )}

      {siblings.length > 1 && (
        <nav aria-label="Pieces in this unit" className="mt-8">
          <Card padding="standard">
            <h2 className="mb-2 text-ui font-semibold text-ink-muted">This unit&rsquo;s pieces</h2>
            <ol className="space-y-1">
              {siblings.map((sibling) => (
                <li key={sibling.id} className="flex items-baseline gap-2 text-ui">
                  <span className="w-5 shrink-0 text-ink-muted tabular-nums">
                    {sibling.ordinal}.
                  </span>
                  {sibling.id === piece.id ? (
                    <span className="font-medium text-ink" aria-current="page">
                      {sibling.title}
                    </span>
                  ) : (
                    <Link
                      href={`/learn/s/${subject.id}/p/${sibling.id}`}
                      className={cn('press-area', linkVariants())}
                    >
                      {sibling.title}
                    </Link>
                  )}
                  {sibling.passed && <span className="text-small text-ink-muted">passed</span>}
                </li>
              ))}
            </ol>
          </Card>
        </nav>
      )}
    </PageColumn>
  );
}

/**
 * The cells the piece teaches, each with where you stand on it and a link to
 * its topic's ladder (plan #2138.13). Nothing is drawn for a piece that names
 * none.
 */
function PieceCells({ cells }: { cells: readonly PieceCellView[] }) {
  if (cells.length === 0) return null;
  return (
    <section aria-labelledby="piece-cells" className="mb-6">
      <h2 id="piece-cells" className="mb-2 text-ui font-semibold text-ink-muted">
        What this piece teaches
      </h2>
      <Card padding="none">
        <ul className="divide-y divide-border">
          {cells.map((cell) => (
            <li
              key={cell.cellId}
              className="card-pad-x flex items-baseline justify-between gap-3 py-3"
            >
              <Link
                href={`/learn/topics/${cell.topicId}`}
                className={cn('press-area min-w-0 flex-1', linkVariants())}
              >
                {cell.topicName}, level {cell.level}
              </Link>
              <span className="inline-flex shrink-0 items-center gap-1 text-small text-ink">
                <StatusGlyph glyph={STATUS_GLYPH[cell.status]} size={12} />
                {STATUS_WORDS[cell.status]}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
