import Link from '@/components/ui/link';
import { segmentClass, segmentedFrame } from '@/components/ui/segmented';
import { nowHref, practiceHref } from '@/lib/learn/flow/href';

/**
 * Now's switch (plan #1486): today's piece, or just the questions Practice
 * Flow used to ask on its own tab. Links onto the page's own search
 * parameter, as the questions' own filter is, so the choice survives a reload
 * and the back button. On a subject's Now (plan #1698) both sides keep the
 * subject, so switching never widens what you were looking at; there the
 * other side is that subject's cards rather than today's piece (plan #2313.1).
 */
export function PracticeSwitch({ practice, track = null }: { practice: boolean; track?: string | null }) {
  const options = [
    { key: 'today', label: track ? 'Cards' : 'Today', href: nowHref(track), on: !practice },
    { key: 'practice', label: 'Practice', href: practiceHref({ track }), on: practice },
  ];
  return (
    <span role="group" aria-label="What Now shows" className={segmentedFrame}>
      {options.map((option) => (
        <Link
          key={option.key}
          href={option.href}
          scroll={false}
          aria-current={option.on ? 'true' : undefined}
          className={segmentClass(option.on)}
        >
          {option.label}
        </Link>
      ))}
    </span>
  );
}
