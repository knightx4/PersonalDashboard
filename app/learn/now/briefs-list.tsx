import Link from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { LiveDot } from '@/components/ui/live-dot';
import { cn } from '@/lib/cn';
import { summaryLine, type BriefSummary } from '@/lib/learn/briefs/view';

/**
 * The topics you asked Dash to research and have not archived (plan
 * #2023.4), on Now under the strip of what is waiting. Each row opens its
 * brief. Nothing is drawn when there are none.
 */
export function BriefsList({ briefs }: { briefs: readonly BriefSummary[] }) {
  if (briefs.length === 0) return null;
  return (
    <Card padding="none" className="mb-4">
      <h2 className="card-pad-x pt-(--card-p) text-ui font-semibold text-ink">Topics you asked Dash to research</h2>
      <ul className="divide-y divide-border">
        {briefs.map((brief) => (
          <li key={brief.id}>
            <Link
              href={`/learn/b/${brief.id}`}
              className="card-pad-x row-pad press block hover:bg-sunken focus-visible:outline-2 focus-visible:-outline-offset-2"
            >
              <span className="block text-body font-medium text-ink [overflow-wrap:anywhere]">{brief.question}</span>
              <span
                className={cn(
                  'mt-0.5 flex items-center gap-2 text-small',
                  brief.status === 'failed' ? 'text-danger' : 'text-ink-muted',
                )}
              >
                {brief.status === 'researching' && <LiveDot />}
                {summaryLine(brief)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
