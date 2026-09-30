import Link from 'next/link';
import { cn } from '@/lib/cn';
import type { MayaPoint, MayaSynthesis } from '@/lib/vault/maya/verify';
import { noteHref } from '@/lib/vault/paths';

/**
 * One of Maya's thoughts as the person reads it: the ranked points, each with
 * the quotes from their own notes and the outside works it leans on, then the
 * synthesis when there is one.
 *
 * Drawn on a note's page under the Maya section (plan #1285) and meant for the
 * thread page too (#1286). It takes the stored shape (readStoredPoints in
 * lib/vault/maya/thought.ts) and renders no client code, so either page can
 * put it straight into a server component.
 *
 * A cited note links to its page when `notePaths` has its path. A note that
 * has since been deleted has none and its title is shown as text. An outside
 * source's gist is always Maya's paraphrase and is marked as one; the work's
 * own words appear only when the web search returned them.
 */

/** What an empty thought says. Verification can leave none, and that is an answer. */
export const MAYA_NOTHING_TO_ADD = 'Maya read this note and had nothing worth adding this time.';

export function MayaPoints({
  points,
  synthesis,
  notePaths = {},
  className,
}: {
  points: MayaPoint[];
  synthesis: MayaSynthesis | null;
  /** Vault path by note id, for linking the notes a point quotes. */
  notePaths?: Record<string, string>;
  className?: string;
}) {
  if (points.length === 0) {
    return <p className={cn('text-ui text-ink-muted', className)}>{MAYA_NOTHING_TO_ADD}</p>;
  }

  return (
    <div className={className}>
      <ol className="space-y-5">
        {points.map((point) => (
          <li key={point.rank} className="flex gap-3">
            <span className="w-4 shrink-0 text-ui font-semibold tabular-nums text-ink-muted">
              {point.rank}
            </span>
            <div className="min-w-0 space-y-2">
              <p className="text-ui font-semibold text-ink">{point.claim}</p>
              <p className="text-ui text-ink">{point.argument}</p>

              {point.notes.map((note, i) => {
                const path = notePaths[note.noteId];
                return (
                  <div key={`n${i}`} className="border-l-2 border-border pl-3 text-small">
                    <p className="text-ink-muted">
                      From{' '}
                      {path ? (
                        <Link href={noteHref(path)} className="text-accent hover:underline">
                          {note.title}
                        </Link>
                      ) : (
                        <span className="text-ink">{note.title}</span>
                      )}
                    </p>
                    <blockquote className="mt-0.5 italic text-ink">
                      &ldquo;{note.quote}&rdquo;
                    </blockquote>
                    <p className="mt-0.5 text-ink-muted">{note.point}</p>
                  </div>
                );
              })}

              {point.sources.map((source, i) => (
                <div key={`s${i}`} className="border-l-2 border-border pl-3 text-small">
                  <p className="text-ink-muted">
                    {source.author}, <cite>{source.work}</cite> (paraphrased)
                  </p>
                  <p className="mt-0.5 text-ink">{source.gist}</p>
                  {source.exactText && (
                    <blockquote className="mt-0.5 italic text-ink">
                      In their words: &ldquo;{source.exactText}&rdquo;
                    </blockquote>
                  )}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ol>

      {synthesis && (
        <div className="mt-5">
          <p className="text-ui font-semibold text-ink">
            Reconciling &ldquo;{synthesis.positionNames[0]}&rdquo; and &ldquo;
            {synthesis.positionNames[1]}&rdquo;
          </p>
          <p className="mt-1 text-ui text-ink">{synthesis.resolution}</p>
        </div>
      )}
    </div>
  );
}
