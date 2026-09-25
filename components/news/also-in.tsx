import Link from 'next/link';
import { cn } from '@/lib/cn';
import { issueHref } from '@/lib/news/issues/list';
import type { AlsoIn } from '@/lib/news/quick/next';

/** Newsletters named on the line before the rest are counted. */
const NAMED = 2;

/**
 * The other newsletters that ran a story's event (plan #865), each a link to
 * that newsletter, after the reason Quick read gives for ranking it high
 * (lib/news/quick/rank.ts) when there is one. Nothing is drawn with neither.
 */
export function AlsoInLine({
  reason = null,
  alsoIn,
  pictures,
  className,
}: {
  reason?: string | null;
  alsoIn: readonly AlsoIn[];
  pictures: boolean;
  className?: string;
}) {
  const named = alsoIn.slice(0, NAMED);
  const more = alsoIn.length - named.length;
  if (!reason && !named.length) return null;
  return (
    <p className={cn('mt-0.5 text-ui text-ink-muted', className)}>
      {reason}
      {reason && named.length > 0 && ' · '}
      {named.length > 0 && (
        <>
          {reason ? 'also in ' : 'Also in '}
          {named.map((other, i) => (
            <span key={other.issueId}>
              {i > 0 && (i === named.length - 1 && more === 0 ? ' and ' : ', ')}
              <Link
                href={issueHref(other.issueId, { original: false, pictures, from: null })}
                className="text-accent hover:underline"
              >
                {other.from}
              </Link>
            </span>
          ))}
          {more > 0 && ` and ${more} more`}
        </>
      )}
    </p>
  );
}
