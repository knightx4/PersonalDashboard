import Link from 'next/link';
import { MayaPoints } from '@/components/vault/maya-points';
import type { NoteThread } from '@/lib/vault/maya/threads';
import { MayaAsk } from './maya-ask';

/**
 * Maya on a note's page (plan #1285).
 *
 * Before the first ask: one sentence on what Maya does, and the press. After
 * it: the link into the thread, and the newest thought itself, folded open,
 * because this is where the person asked and the thread page is one more
 * click. The press comes back only when the note has changed since Maya read
 * it, or the thread has no thought yet; asking again about the same text
 * would pay for the same reading.
 *
 * Only drawn for notes the vault reads: the page shows the whyNotRead
 * sentence instead for the rest.
 */
export function MayaSection({
  notePath,
  noteBlobSha,
  thread,
}: {
  notePath: string;
  noteBlobSha: string | null;
  thread: NoteThread | null;
}) {
  const latest = thread?.latest ?? null;
  const changed = Boolean(
    latest && latest.noteBlobSha && noteBlobSha && latest.noteBlobSha !== noteBlobSha,
  );

  return (
    <section aria-labelledby="maya-heading" className="mt-10">
      <h2 id="maya-heading" className="text-body font-semibold text-ink">
        Maya
      </h2>

      {thread ? (
        <>
          <p className="mt-2 text-ui">
            <Link href={`/vault/maya/${thread.id}`} className="text-accent hover:underline">
              In Maya: {thread.question}
            </Link>
          </p>
          {latest && (
            <details open className="mt-3">
              <summary className="cursor-pointer text-ui text-ink-muted">
                {summaryLine(latest.points.length, latest.createdAt)}
              </summary>
              <MayaPoints
                className="mt-3"
                points={latest.points}
                synthesis={latest.synthesis}
                notePaths={thread.notePaths}
              />
            </details>
          )}
          {changed && (
            <p className="mt-3 text-ui text-ink-muted">The note has changed since Maya read it.</p>
          )}
          {(changed || !latest) && <MayaAsk notePath={notePath} again />}
        </>
      ) : (
        <>
          <p className="mt-2 text-ui text-ink-muted">
            Maya reads this note beside your related notes and what others have written on the same
            question, and writes up to three points worth thinking about.
          </p>
          <MayaAsk notePath={notePath} again={false} />
        </>
      )}
    </section>
  );
}

function summaryLine(points: number, createdAt: string): string {
  const day = new Date(createdAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const count = points === 0 ? 'nothing to add' : points === 1 ? '1 point' : `${points} points`;
  return `Maya's thought, ${day} · ${count}`;
}
