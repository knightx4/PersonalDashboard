import { cn } from '@/lib/cn';
import { initials } from '@/lib/you/board-questions';

/**
 * A guest advisor's mark: their initials in a small round badge (plan
 * #2561.4). A guest is a persona Dash built from the person's public work,
 * so the tab never shows a face or a signature for one, only the initials
 * beside the name.
 */
export function AdvisorMark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'tabular inline-flex size-5 shrink-0 items-center justify-center rounded-pill bg-sunken text-micro font-semibold leading-none',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
