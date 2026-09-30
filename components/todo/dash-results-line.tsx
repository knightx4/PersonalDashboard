import Link from 'next/link';

/** Where Dash's results are read: the "What Dash did" section on the Goals home. */
export const DASH_RESULTS_HREF = '/goals#done-heading';

/**
 * One line saying Dash has finished work you have not read yet (plan #1268),
 * linking to where it is read on the Goals home. Nothing at zero: a quiet
 * line that is always there stops being read.
 */
export function DashResultsLine({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <p className={className}>
      <Link
        href={DASH_RESULTS_HREF}
        className="text-ui font-medium text-accent underline decoration-border underline-offset-2 transition-colors duration-150 hover:decoration-accent"
      >
        Dash finished {count} {count === 1 ? 'thing' : 'things'} for you
      </Link>
    </p>
  );
}
