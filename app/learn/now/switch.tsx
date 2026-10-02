import Link from 'next/link';
import { segmentedFrame } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { NOW_HREF, practiceHref } from '@/lib/learn/flow/href';

/**
 * Now's Practice only switch (plan #1486): the feed, or just the questions
 * Practice Flow used to ask on its own tab. Links onto the page's own search
 * parameter, as the questions' own filter is, so the choice survives a reload
 * and the back button.
 */
export function PracticeSwitch({ practice }: { practice: boolean }) {
  const options = [
    { key: 'feed', label: 'Feed', href: NOW_HREF, on: !practice },
    { key: 'practice', label: 'Practice only', href: practiceHref(), on: practice },
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
            'transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2',
            option.on ? 'bg-accent-tint text-accent' : 'bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
          )}
        >
          {option.label}
        </Link>
      ))}
    </span>
  );
}
