import { cn } from '@/lib/cn';
import { PERSON_BADGE_CLASS, PERSON_DOT_CLASS, type Person } from '@/lib/people/load';

/**
 * Whose is it.
 *
 * Small on purpose. It appears on every order row and every inventory row, so
 * it has to read at a glance and then get out of the way -- the name is the
 * answer, and anything more would compete with the thing you came to look at.
 *
 * Renders nothing at all when there is nobody to distinguish from. On a
 * single-person account a label saying "Chris" on all of Chris's shopping is
 * pure noise.
 */
export function PersonBadge({
  person,
  className,
}: {
  person: Person | null | undefined;
  className?: string;
}) {
  if (!person) return null;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-micro font-medium',
        PERSON_BADGE_CLASS[person.colour],
        className,
      )}
      title={`${person.name}'s`}
    >
      {person.name}
    </span>
  );
}

/** The dot form, for a row that is already carrying enough words. */
export function PersonDot({
  person,
  className,
}: {
  person: Person | null | undefined;
  className?: string;
}) {
  if (!person) return null;

  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', PERSON_DOT_CLASS[person.colour], className)}
      title={`${person.name}'s`}
      aria-label={`${person.name}'s`}
    />
  );
}
