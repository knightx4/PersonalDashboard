import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { z } from 'zod';
import { PageHeader } from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadPiecePage } from '@/lib/learn/lessons/piece-store';
import { PieceCheckCard, PieceLessons } from './piece-view';

export const dynamic = 'force-dynamic';

/**
 * Writing a missing lesson is one Sonnet call of up to a minute, and the
 * page's actions inherit this ceiling.
 */
export const maxDuration = 120;

/**
 * One piece of a learning goal's plan (plan #1141, LEARN-LESSONS-SPEC "A
 * piece is worked through on its own page"): its lessons in order, then its
 * check. Any piece opens, in any order; nothing is locked by the suggested
 * one. The piece is passed only by a right answer to its check.
 */
export default async function PiecePage({ params }: { params: Promise<{ id: string; piece: string }> }) {
  const { id, piece: pieceId } = await params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(pieceId).success) notFound();

  const user = await requireUser();
  const learn = await createLearnClient();
  const page = await loadPiecePage(learn, user.id, id, pieceId);
  if (!page) notFound();

  const { piece, subject, unit, siblings } = page;

  return (
    <>
      <p className="mb-3">
        <Link
          href={`/learn/s/${subject.id}`}
          className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
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

      {page.ideas.length === 0 ? (
        <p className="mb-6 text-body text-ink-muted">The ideas this piece covered are no longer in the track.</p>
      ) : (
        <>
          <PieceLessons subjectId={subject.id} pieceId={piece.id} ideas={page.ideas} />
          <div className="mt-6">
            <PieceCheckCard
              subjectId={subject.id}
              pieceId={piece.id}
              check={page.check}
              passedAt={piece.passedAt}
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
                  <Link href={`/learn/s/${subject.id}/p/${sibling.id}`} className="text-accent hover:underline">
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
