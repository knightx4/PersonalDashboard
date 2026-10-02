import Link from 'next/link';
import { Card } from '@/components/ui/card';
import type { WaitingLine } from '@/lib/learn/feed/waiting';

/**
 * What is waiting for you, as one short strip at the top of Now (plan #1486):
 * the lines Learn's Home tab listed (plan #1311), minus the cards ready in the
 * feed, which is the page this sits on. With nothing waiting it draws
 * nothing, since the feed below is the next thing either way; when a count
 * could not be read it says so in a line rather than claiming nothing waits.
 */
export function WaitingStrip({
  lines,
  empty,
}: {
  lines: readonly WaitingLine[];
  empty: 'nothing' | 'unread' | null;
}) {
  if (lines.length === 0) {
    return empty === 'unread' ? (
      <p className="mb-4 text-ui text-ink-muted">What is waiting for you could not be read. Reload to try again.</p>
    ) : null;
  }
  return (
    <Card padding="none" className="mb-4">
      <div className="card-pad-x row-pad flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-ui font-semibold text-ink">Waiting for you</h2>
        <ul className="contents">
          {lines.map((line) => (
            <li key={line.key}>
              <Link href={line.href} className="text-ui text-accent hover:underline">
                {line.text}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
