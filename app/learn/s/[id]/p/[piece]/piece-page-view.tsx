import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import type { PiecePage } from '@/lib/learn/lessons/piece-store';
import type { PracticeView } from '@/lib/learn/lessons/practice';
import type { DueReview } from '@/lib/learn/lessons/review';
import { ReviewList } from '@/app/learn/review/review-list';
import { PieceLessons, PiecePassing } from './piece-view';

export type PiecePageProps = {
  page: PiecePage;
  practice: PracticeView | null;
  standing: { practicePassed: boolean; checkPassed: boolean };
  /** Ideas from this plan's passed pieces due for review, this piece's own left out. */
  reviews: DueReview[];
};

/** One piece of a learning goal's plan, from what its page read (plan #1602). */
export function PiecePageView({ page, practice, standing, reviews }: PiecePageProps) {
  const { piece, subject, unit, siblings } = page;

  return (
    <>
      <p className="mb-3">
        <Link
          href={`/learn/s/${subject.id}`}
          className="press-area inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          {subject.name}
        </Link>
      </p>

      <PageHeader
        title={piece.title}
        description={`Unit ${unit.ordinal}, ${unit.title} · piece ${piece.ordinal} of ${siblings.length}${
          piece.passedAt ? ' · passed' : ''
        }`}
      />

      {unit.outcome && (
        <p className="mb-5 text-ui text-ink-muted">
          <span className="text-ink">By the end of the unit: </span>
          {unit.outcome}
        </p>
      )}

      <ReviewList
        reviews={reviews}
        title="First, from earlier pieces"
        description="Due for review today. A right answer brings the next question later; a miss brings it back tomorrow."
        showPlan={false}
      />

      {page.ideas.length === 0 ? (
        <p className="mb-6 text-body text-ink-muted">The ideas this piece covered are no longer in the subject.</p>
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
            />
          </div>
        </>
      )}

      {siblings.length > 1 && (
        <nav aria-label="Pieces in this unit" className="mt-8">
          <h2 className="mb-2 text-ui font-semibold text-ink-muted">This unit&rsquo;s pieces</h2>
          <ol className="space-y-1">
            {siblings.map((sibling) => (
              <li key={sibling.id} className="flex items-baseline gap-2 text-ui">
                <span className="w-5 shrink-0 text-ink-muted tabular-nums">{sibling.ordinal}.</span>
                {sibling.id === piece.id ? (
                  <span className="font-medium text-ink" aria-current="page">
                    {sibling.title}
                  </span>
                ) : (
                  <Link href={`/learn/s/${subject.id}/p/${sibling.id}`} className="press-area text-accent hover:underline">
                    {sibling.title}
                  </Link>
                )}
                {sibling.passed && <span className="text-small text-ink-muted">passed</span>}
              </li>
            ))}
          </ol>
        </nav>
      )}
    </>
  );
}
