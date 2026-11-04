import { Plus } from 'lucide-react';
import { Messaging, MessagingPlaceholder, PersonMark } from '@/components/patterns/messaging';
import { buttonVariants } from '@/components/ui/button';
import Link from '@/components/ui/link';
import { PageColumn } from '@/components/shell/page-width';
import { cn } from '@/lib/cn';
import { botLineOf, botsOf, personInitials, type PersonRow } from '@/lib/you/chat-threads-model';
import { ADD_HREF, editHref } from '@/lib/you/people-cards-model';

/**
 * Chat's Bots tab (plan #2879.3), the messaging pattern as Messages draws
 * it: every bot on the roster A to Z on the left, and the open bot's form on
 * the right. On a phone the list is the page and a bot's form a page of its
 * own. Add a bot sits at the head of the list; deleting one is at the foot
 * of its form.
 */
export function BotsView({
  rows,
  failed = false,
  current = null,
  adding = false,
  children,
}: {
  /** Everyone on the roster, in any order. */
  rows: readonly PersonRow[];
  failed?: boolean;
  /** The key of the bot whose form is open. */
  current?: string | null;
  /** The form for a new bot is open. */
  adding?: boolean;
  /** The open form, when one is. */
  children?: React.ReactNode;
}) {
  if (!failed && rows.length === 0 && !adding) {
    return (
      <PageColumn>
        <section className="sheet rounded-card bg-surface px-4 py-4">
          <h2 className="font-display text-title font-semibold tracking-tight text-ink">Bots</h2>
          <p className="mt-4 text-body font-semibold text-ink">No bots yet</p>
          <p className="mt-1 text-ui text-ink-muted">Add one, say who they are and how they talk, and Dash writes the card every reply reads.</p>
          <div className="mt-3">
            <Link href={ADD_HREF} className={buttonVariants({ variant: 'primary' })}>
              Add a bot
            </Link>
          </div>
        </section>
      </PageColumn>
    );
  }
  if (failed) {
    return (
      <Messaging
        label="Bots"
        open={false}
        list={
          <div className="flex flex-col px-4 pt-4 pb-4">
            <h2 className="font-display text-title font-semibold tracking-tight text-ink">Bots</h2>
            <p className="mt-3 text-ui text-danger">Your bots could not be read. Reload to try again.</p>
          </div>
        }
      >
        <MessagingPlaceholder>
          <p className="text-ui text-ink-muted">A bot&rsquo;s form opens here once they can be read.</p>
        </MessagingPlaceholder>
      </Messaging>
    );
  }
  return (
    <Messaging label="Bots" open={Boolean(children)} list={<BotsList rows={rows} current={current} adding={adding} />}>
      {children ?? (
        <MessagingPlaceholder>
          <p className="text-body font-medium text-ink">Choose a bot to edit it here.</p>
        </MessagingPlaceholder>
      )}
    </Messaging>
  );
}

function BotsList({ rows, current, adding }: { rows: readonly PersonRow[]; current: string | null; adding: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4 pb-2">
        <h2 className="font-display text-title font-semibold tracking-tight text-ink">Bots</h2>
        <Link
          href={ADD_HREF}
          aria-current={adding ? 'page' : undefined}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-mr-2', adding && 'bg-accent-tint text-ink')}
        >
          <Plus className="size-4" strokeWidth={1.75} aria-hidden />
          Add a bot
        </Link>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {botsOf(rows).map((row) => {
          const line = botLineOf(row);
          const lit = row.key === current;
          return (
            <li key={row.id}>
              <Link
                href={editHref(row.key)}
                aria-current={lit ? 'page' : undefined}
                className={cn(
                  'grid min-h-11 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-2.5 rounded-control px-2 py-2 hover:bg-sunken',
                  lit && 'bg-accent-tint hover:bg-accent-tint',
                )}
              >
                <PersonMark initials={personInitials(row.name)} colour={row.colour} />
                <span className="min-w-0">
                  <span className="block truncate text-body font-semibold text-ink">{row.name}</span>
                  {line && <span className="block truncate text-small text-ink-muted">{line}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
