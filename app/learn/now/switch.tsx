import Link from '@/components/ui/link';
import { segmentedFrame } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { nowHref, practiceHref } from '@/lib/learn/flow/href';

/**
 * Now's Practice only switch (plan #1486): the feed, or just the questions
 * Practice Flow used to ask on its own tab. Links onto the page's own search
 * parameter, as the questions' own filter is, so the choice survives a reload
 * and the back button. On a subject's Now (plan #1698) both sides keep the
 * subject, so switching never widens what you were looking at.
 */
export function PracticeSwitch({ practice, track = null }: { practice: boolean; track?: string | null }) {
  const options = [
    { key: 'feed', label: 'Feed', href: nowHref(track), on: !practice },
    { key: 'practice', label: 'Practice only', href: practiceHref({ track }), on: practice },
  ];
  return (
    <span role="group" aria-label="What Now shows" className={segmentedFrame}>
      {options.map((option) => (
        <Link
          key={option.key}
          href={option.href}
          scroll={false}
          aria-current={option.on ? 'true' : undefined}
          className={cn(
            'press inline-flex h-(--control-h) items-center px-2.5 text-ui font-medium',
            'transition-colors duration-quick focus-visible:outline-2 focus-visible:-outline-offset-2',
            option.on ? 'bg-accent-tint text-accent' : 'bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
          )}
        >
          {option.label}
        </Link>
      ))}
    </span>
  );
}
