import { cn } from '@/lib/cn';

/**
 * The checks that say what understanding a claim looks like.
 *
 * Shown in two places and written once: under a claim on an approval screen,
 * where refusing a bad check is still possible, and on the concept's own page
 * afterwards. Both are reading positions rather than editing ones, so the
 * checks sit in the same small muted type the basis already uses and do not
 * compete with the claim above them.
 *
 * Spans rather than a `ul`, with the list semantics put back by `role`. Two of
 * the call sites render inside a span already, and a list inside phrasing
 * content is markup a browser is entitled to do anything it likes with.
 */
export function MasteryChecks({ checks, className }: { checks: string[]; className?: string }) {
  if (checks.length === 0) {
    // Said rather than left blank: a concept nobody wrote checks for is a
    // concept whose questions will be written against the claim in general,
    // and that is worth knowing before you approve it.
    return (
      <span className={cn('block text-small text-ink-muted', className)}>
        No checks were written for this one.
      </span>
    );
  }

  return (
    <span role="list" className={cn('block space-y-0.5', className)}>
      {checks.map((check) => (
        <span key={check} role="listitem" className="flex gap-1.5 text-small text-ink-muted">
          <span aria-hidden>•</span>
          <span>{check}</span>
        </span>
      ))}
    </span>
  );
}
