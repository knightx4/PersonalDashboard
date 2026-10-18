import type { LucideIcon } from 'lucide-react';
import Link from '@/components/ui/link';
import { segmentClass, segmentedFrame } from '@/components/ui/segmented';

/** One view a page offers, with the link that opens it. */
export type ViewSwitchOption<V extends string> = { value: V; label: string; Icon: LucideIcon; href: string };

/**
 * A page's views, as links kept in the address (plan #1590, shared by plan
 * #2341.2). Links rather than buttons: the view is part of the URL, so the
 * back button undoes it and a link to the table opens the table. The page
 * builds each link, since what a view keeps or drops on the way is its own.
 */
export function ViewSwitch<V extends string>({
  label,
  views,
  current,
}: {
  /** What the group is, for a screen reader: "Pipeline view". */
  label: string;
  views: readonly ViewSwitchOption<V>[];
  current: V;
}) {
  return (
    <span role="group" aria-label={label} className={segmentedFrame}>
      {views.map(({ value, label: name, Icon, href }) => (
        <Link
          key={value}
          href={href}
          scroll={false}
          aria-current={current === value ? 'true' : undefined}
          className={segmentClass(current === value)}
        >
          <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
          {name}
        </Link>
      ))}
    </span>
  );
}
