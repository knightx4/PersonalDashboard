import Link from 'next/link';
import { segmentedFrame } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { practiceHref } from '@/lib/learn/flow/href';
import type { FlowOnly } from './session';

/**
 * The line above a flow focused on one track (plan #779) or one goal (plan
 * #1387): what it asks about, and the way back to asking about the rest. Apart
 * from the page so the preview gallery can show it.
 */
export function FlowFocus({ name, back }: { name: string; back: string }) {
  return (
    <p className="mt-4 flex flex-wrap items-baseline gap-x-3 text-ui text-ink-muted">
      <span>
        Only asking about <span className="font-medium text-ink">{name}</span>
      </span>
      <Link href={practiceHref()} className="text-accent hover:underline">
        {back}
      </Link>
    </p>
  );
}

/**
 * What the mixed flow asks about (plan #842): everything, which mixes in
 * questions about subjects in your notes that are not tracks and about your
 * goals, your tracks alone, or your goals alone (plan #1387). Links onto the
 * page's own search parameter, as the ideas page's arrangement rows are, so
 * the choice survives a reload and the back button.
 */
export function ScopeFilter({ filter }: { filter: FlowOnly }) {
  const options = [
    { key: 'all', label: 'Everything', href: practiceHref(), on: filter === null },
    {
      key: 'tracks',
      label: 'Subjects only',
      href: practiceHref({ only: 'tracks' }),
      on: filter === 'tracks',
    },
    { key: 'goals', label: 'Goals only', href: practiceHref({ only: 'goals' }), on: filter === 'goals' },
  ];
  return (
    <div className="mt-4">
      <span role="group" aria-label="What to ask about" className={segmentedFrame}>
        {options.map((option) => (
          <Link
            key={option.key}
            href={option.href}
            scroll={false}
            aria-current={option.on ? 'true' : undefined}
            className={cn(
              'press inline-flex h-(--control-h) items-center px-2.5 text-ui font-medium',
              'transition-colors duration-quick focus-visible:outline-2 focus-visible:-outline-offset-2',
              option.on
                ? 'bg-accent-tint text-accent'
                : 'bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
            )}
          >
            {option.label}
          </Link>
        ))}
      </span>
    </div>
  );
}
