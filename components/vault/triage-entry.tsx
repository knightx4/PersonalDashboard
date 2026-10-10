import Link from 'next/link';
import { ChevronRight, Inbox } from 'lucide-react';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

/**
 * The Quick note triage row at the top of the vault's note list (plan #1729):
 * how many quick notes are waiting in the Inbox, and the way to them.
 */
export function TriageEntry({ waiting }: { waiting: number }) {
  return (
    <Link
      href="/vault/triage"
      className={cn(
        cardVariants(),
        'mb-5 flex items-center gap-3 px-4 py-3 transition-colors duration-quick hover:bg-canvas',
      )}
    >
      <Inbox className="size-4 shrink-0 text-ink-muted" strokeWidth={2} aria-hidden />
      <span className="min-w-0 flex-1 text-body font-medium text-ink">Quick note triage</span>
      <span className="tabular shrink-0 text-ui text-ink-muted">
        {waiting === 0 ? 'Nothing waiting' : `${waiting} waiting`}
      </span>
      <ChevronRight className="size-4 shrink-0 text-ink-muted" strokeWidth={2} aria-hidden />
    </Link>
  );
}
