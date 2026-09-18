import { SectionFold } from '@/components/ui/disclosure';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { OtherFeedbackRow } from '@/lib/feedback/load';

/**
 * What the other accounts have filed, under your own two sections.
 *
 * Three accounts sign in to this app and all three can press the message
 * button; until #412 a note any of them filed landed where nobody would ever
 * see it. This is where those notes surface, and it is deliberately the
 * plainest list on the page:
 *
 *  - **Read-only.** #414 settled it. No status select, no priority, no answer
 *    box, no edit, no delete -- the triage actions still refuse another
 *    account's row, and the policy added in migration 0086 widens select and
 *    nothing else, so a button here would be a button that cannot work.
 *  - **Below Outstanding and Closed**, because those two are your notes and
 *    what you came here to work. This is the inbox beside them.
 *  - **Absent when empty.** Not an empty state: a heading saying nobody has
 *    filed anything is a heading you read every visit to learn nothing.
 *
 * Each row says who filed it, because that is the only thing the row itself
 * does not carry -- `feedback_items` has no email column, and the address is
 * resolved by `feedback_filer_emails()` for the owner alone.
 */
export function OtherUsersFeedback({ rows }: { rows: OtherFeedbackRow[] }) {
  if (rows.length === 0) return null;

  return (
    <SectionFold
      title="Other users"
      count={rows.length}
      hint="Filed by the other accounts. Read-only."
    >
      <ul
        className={cn(cardVariants({ padding: 'none' }), 'divide-y divide-border overflow-hidden')}
      >
        {rows.map((row) => (
          <li key={row.id} className="row-pad flex flex-col gap-2 px-4">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wide',
                  row.kind === 'bug' ? 'bg-danger-tint text-danger' : 'bg-accent-tint text-accent',
                )}
              >
                {row.kind}
              </span>
              {/* The account, first among the facts: on this list it is the
                  one thing the note itself cannot tell you. */}
              <span className="text-ui text-ink">{row.email ?? 'another account'}</span>
              <span className="text-small text-ink-muted">
                {row.createdAt.slice(0, 10)}
                {row.pagePath ? ` · ${row.pagePath}` : ''}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-body text-ink">{row.body}</p>
          </li>
        ))}
      </ul>
    </SectionFold>
  );
}
