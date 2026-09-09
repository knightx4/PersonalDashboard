import { cn } from '@/lib/cn';

/**
 * A set of values, read.
 *
 * The read half of law 14. A panel of settings, details or properties is a
 * list of answers, and the app kept drawing it as a list of editors: a label,
 * a bordered box holding the value, and a caption, stacked seven deep with a
 * Save at the bottom. Seven boxes is what a form looks like, so the panel read
 * as a form whether or not anybody was filling one in -- and the values, which
 * are the point, were never shown as values at all.
 *
 * A `<dl>` because that is literally what this is: give the section one Edit,
 * and put the labelled fields behind it.
 *
 * `@container` is what makes the rows below able to lay themselves out. These
 * lists appear both across a page and down a 320px sidebar, and a viewport
 * breakpoint cannot tell those apart -- it put a 176px label column beside a
 * 140px value column in the sidebar and wrapped "New York, NY" onto two lines
 * on a laptop.
 */
export function ValueList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <dl className={cn('@container space-y-2', className)}>{children}</dl>;
}

/**
 * One name and its value.
 *
 * Side by side where the list is wide enough for it, stacked where it is not.
 * An unset value says "Not set" in ghost rather than leaving the line blank: a
 * blank where a value should be is indistinguishable from a value that failed
 * to load, which is the failure law 2 exists to prevent.
 */
export function ValueRow({
  label,
  value,
  className,
}: {
  label: string;
  /** A string, or a rendered value -- a link, a chip, a formatted number. */
  value: React.ReactNode;
  className?: string;
}) {
  const empty =
    value === null || value === undefined || (typeof value === 'string' && !value.trim());

  return (
    <div className={cn('@md:flex @md:items-baseline @md:gap-3', className)}>
      <dt className="shrink-0 text-small text-ink-muted @md:w-40">{label}</dt>
      {/* Breaking mid-word is not optional here: a homepage, a careers page
          and a LinkedIn URL are all values in this list, and a URL offers no
          break opportunity at all -- it ran straight out of the side of the
          card. `anywhere` rather than `break-words` because the latter only
          breaks a word that cannot fit on a line of its own, which a URL
          shorter than the column still technically can while overflowing it.
          A value here must never set `truncate`: `white-space: nowrap` beats
          all of this and puts the overflow back. */}
      <dd className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-ui leading-relaxed text-ink">
        {empty ? <span className="text-ink-ghost">Not set</span> : value}
      </dd>
    </div>
  );
}
