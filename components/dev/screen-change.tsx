import { cn } from '@/lib/cn';
import type { ScreenChangeView } from '@/lib/plan/screen-change';

/**
 * A step's changed screens as phone pictures (plan #1541,
 * docs/UI-QUALITY-SPEC.md Part 6): before and after side by side on the
 * opened plan row, and the after picture alone on a changelog line.
 *
 * Each picture links to itself at full size. Nothing here holds state, so the
 * plan row (a client component) and the changelog (a server one) both draw
 * it. The pictures load lazily, so a closed row or line fetches nothing.
 *
 * `footer` is drawn under each surface's pictures: the place a press about
 * that screen goes (#1542's thumbs-down).
 */

function Picture({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <a href={src} target="_blank" rel="noreferrer" className="press block rounded-md">
      {/* eslint-disable-next-line @next/next/no-img-element -- a redirect to a signed link in the private ui-shots bucket */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        // ui-ok: the edge of a photograph of a screen, so a dark shot keeps its outline on the panel
        className={cn(
          'aspect-[9/16] w-full rounded-md border border-border bg-sunken object-cover object-top',
          className,
        )}
      />
    </a>
  );
}

/** Where a picture would be, saying why there is none. */
function Missing({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex aspect-[9/16] w-full items-center justify-center rounded-md bg-sunken p-3 text-center text-small text-ink-muted">
      {children}
    </div>
  );
}

function roundLine(change: ScreenChangeView): string {
  return change.verdict === 'accepted'
    ? `accepted by you after round ${change.round - 1}`
    : `passed in round ${change.round}`;
}

/** Before and after for each surface a step changed, for the opened plan row. */
export function ScreenChanges({
  changes,
  footer,
}: {
  changes: readonly ScreenChangeView[];
  footer?: (change: ScreenChangeView) => React.ReactNode;
}) {
  if (changes.length === 0) return null;
  return (
    <section aria-label="Screens this step changed" className="space-y-4">
      {changes.map((change) => (
        <div key={change.surface} className="max-w-md space-y-2">
          <p className="text-small text-ink-muted">
            <span className="font-mono text-ink">{change.surface}</span> · {roundLine(change)}
          </p>
          {/* Neither picture means none were uploaded, which says nothing
              about whether the screen is new: one line, not two empty boxes. */}
          {!change.before && !change.after ? (
            <p className="text-small text-ink-muted">
              The session that checked it could not upload its pictures.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <figure className="space-y-1">
                <figcaption className="text-micro font-semibold uppercase tracking-wide text-ink-muted">
                  Before
                </figcaption>
                {change.before ? (
                  <Picture
                    src={change.before}
                    alt={`${change.surface} before this step, on a phone`}
                  />
                ) : (
                  <Missing>A new screen: nothing to compare with</Missing>
                )}
              </figure>
              <figure className="space-y-1">
                <figcaption className="text-micro font-semibold uppercase tracking-wide text-ink-muted">
                  After
                </figcaption>
                {change.after ? (
                  <Picture
                    src={change.after}
                    alt={`${change.surface} after this step, on a phone`}
                  />
                ) : (
                  <Missing>Not uploaded by the session that checked it</Missing>
                )}
              </figure>
            </div>
          )}
          {footer?.(change)}
        </div>
      ))}
    </section>
  );
}

/** The after pictures alone, for a changelog line. Surfaces with none uploaded are left out. */
export function ScreenAfters({ changes }: { changes: readonly ScreenChangeView[] }) {
  const shown = changes.filter((c) => c.after);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {shown.map((change) => (
        <figure key={change.surface} className="w-36 space-y-1">
          <Picture src={change.after!} alt={`${change.surface} after this change, on a phone`} />
          <figcaption className="truncate font-mono text-micro text-ink-muted">
            {change.surface}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
