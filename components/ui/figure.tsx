import { cn } from '@/lib/cn';

/**
 * The one figure a page is about.
 *
 * It is not in a card. A card says "one of several things on this page", and
 * this is the reason the page exists, so it stands on the page ground in the
 * display face at the largest size the type scale has, with everything that
 * explains it hung beneath as a caption. The secondary figures -- the ones
 * that used to get a card each and so competed with it -- sit in a quiet row
 * under a rule.
 *
 * Law 7 holds: the number itself is set plainly, in tabular figures, with no
 * colour and no motion beyond the count-up it already had. Its scale is the
 * statement. Nothing else on a page is ever set at `text-figure-xl`.
 */
export function Figure({
  label,
  meta,
  value,
  caption,
  aside,
  secondary,
  className,
}: {
  /** What the number is: "Spent this month". */
  label: React.ReactNode;
  /** The right-hand end of the label line: a date range, a currency. */
  meta?: React.ReactNode;
  value: React.ReactNode;
  /** The line under the figure that makes it reconcile: "$1,843 gross, less $120 refunded". */
  caption?: React.ReactNode;
  /** A delta or a sparkline; sits before the caption on the same line. */
  aside?: React.ReactNode;
  /** The numbers that used to get a card each. */
  secondary?: readonly { value: React.ReactNode; label: React.ReactNode; href?: string }[];
  className?: string;
}) {
  return (
    <section className={cn('min-w-0', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-ui text-ink-muted">
        <span className="font-medium">{label}</span>
        {meta && <span className="tabular">{meta}</span>}
      </div>
      <p className="font-display tabular mt-1 text-figure-lg font-semibold tracking-[-0.04em] text-ink sm:text-figure-xl">
        {value}
      </p>
      {(aside || caption) && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-ui text-ink-muted">
          {aside}
          {caption && <span>{caption}</span>}
        </div>
      )}
      {secondary && secondary.length > 0 && (
        <>
          <div className="mt-5 h-px bg-border-strong" aria-hidden />
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
            {secondary.map((entry, index) => (
              <div key={index} className="min-w-0">
                <dd className="tabular text-lead font-semibold tracking-tight text-ink">
                  {entry.href ? (
                    <a href={entry.href} className="hover:text-accent">
                      {entry.value}
                    </a>
                  ) : (
                    entry.value
                  )}
                </dd>
                <dt className="text-small text-ink-muted">{entry.label}</dt>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}

/**
 * A period-over-period change, said once, with the colour rule the design
 * language sets: green means money came back, so a falling spend is the only
 * delta that earns it. Rising is plain ink -- a fact, not an alarm.
 */
export function FigureDelta({
  label,
  direction,
  suffix,
}: {
  label: string | null;
  direction: 'up' | 'down' | 'flat' | null;
  suffix?: string;
}) {
  if (label === null) return <span>No prior period to compare</span>;
  return (
    <span>
      <span
        className={cn(
          'tabular font-medium',
          direction === 'down' ? 'text-positive' : direction === 'up' ? 'text-ink' : 'text-ink-muted',
        )}
      >
        {label}
      </span>
      {suffix && ` ${suffix}`}
    </span>
  );
}
