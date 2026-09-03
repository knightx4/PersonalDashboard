import Link from 'next/link';
import { Briefcase, ListChecks, NotebookPen, ShoppingBag } from 'lucide-react';
import { requireUser, createClient } from '@/lib/auth/server';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import { TERMINAL_STATUSES } from '@/lib/jobs/pipeline';
import { FeedbackButton } from '@/components/shell/feedback-button';
import { WorkspaceSwitcher } from '@/components/shell/workspace-switcher';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { loadAgenda } from '@/lib/todo/agenda/load';
import { BUCKET_LABELS } from '@/lib/todo/tasks/model';
import type { ModuleId } from '@/lib/modules';

export const metadata = { title: 'Home' };

/**
 * The front door to the account, not to any one workspace.
 *
 * It used to be two tiles and two counts, and no reason to visit. What it was
 * missing is the one question none of the workspaces can answer on its own --
 * what has to happen today -- so the top of the agenda goes here, above the
 * tiles, and the tiles become what they always were: the way in.
 *
 * A switched-off workspace is not listed. That is what the switch means.
 */
export default async function HomePage() {
  const user = await requireUser();
  const settings = await loadAccountSettings(user.id);

  const [counts, agenda] = await Promise.all([
    loadCounts(user.id, settings.enabledModules),
    moduleEnabled(settings, 'todo') ? loadAgenda(user.id) : null,
  ]);

  const displayName = settings.displayName;
  const initial = (displayName || user.email || '').charAt(0).toUpperCase();

  // The two or three things that actually need today, not the whole agenda.
  // A front door showing forty rows is a list, and there is already a page for
  // the list.
  const due = (agenda?.piles ?? [])
    .filter((pile) => pile.bucket === 'overdue' || pile.bucket === 'today')
    .flatMap((pile) => pile.entries.map((entry) => ({ pile: pile.bucket, entry })))
    .slice(0, 4);

  const tiles = [
    {
      module: 'todo' as ModuleId,
      href: '/todo',
      icon: ListChecks,
      title: 'Todo',
      stat: counts.tasks === null ? '—' : `${counts.tasks} open`,
    },
    {
      module: 'shopping' as ModuleId,
      href: '/shopping/dashboard',
      icon: ShoppingBag,
      title: 'Shopping',
      stat: counts.items === null ? '—' : `${counts.items} item${counts.items === 1 ? '' : 's'} tracked`,
    },
    {
      module: 'jobs' as ModuleId,
      href: '/jobs/today',
      icon: Briefcase,
      title: 'Job search',
      stat:
        counts.pursuits === null
          ? '—'
          : `${counts.pursuits} open pursuit${counts.pursuits === 1 ? '' : 's'}`,
    },
    {
      module: 'vault' as ModuleId,
      href: '/vault',
      icon: NotebookPen,
      title: 'Vault',
      stat: counts.notes === null ? '—' : `${counts.notes} note${counts.notes === 1 ? '' : 's'}`,
    },
  ].filter((tile) => moduleEnabled(settings, tile.module));

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
          <WorkspaceSwitcher current={null} enabled={settings.enabledModules} />
          <div className="flex-1" />
          <FeedbackButton />
          <Link
            href="/account"
            className="press flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[13px] font-semibold text-brand"
            title={displayName ?? user.email ?? ''}
          >
            {initial}
            <span className="sr-only">Account</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Home</h1>

        {/* Nothing at all when there is nothing at all -- no "0 things due",
            no empty card. A quiet day should look quiet, and a front door that
            insists on saying something is a front door people stop reading. */}
        {due.length > 0 && (
          <section className="mt-6 rounded-card border border-border bg-surface p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">Today</h2>
              <Link
                href="/todo"
                className="text-[12px] font-medium text-brand underline underline-offset-2"
              >
                The agenda
              </Link>
            </div>

            <ul className="mt-2 divide-y divide-border">
              {due.map(({ pile, entry }) => (
                <li key={entry.key} className="flex items-baseline gap-2 py-1.5">
                  {pile === 'overdue' && (
                    <span className="shrink-0 text-[11px] font-medium text-status-rejected">
                      {BUCKET_LABELS.overdue}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {entry.task?.title ?? entry.item?.title}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {tiles.map((tile) => (
            <ModuleCard key={tile.module} {...tile} />
          ))}
        </div>
      </main>
    </div>
  );
}

/**
 * One count per workspace, and only for the ones that are on.
 *
 * Each is allowed to fail on its own. A vault whose token expired must not
 * cost you the front door -- the tile says "—" and the rest of the page is
 * unchanged.
 */
async function loadCounts(
  userId: string,
  enabled: readonly ModuleId[],
): Promise<{
  items: number | null;
  pursuits: number | null;
  notes: number | null;
  tasks: number | null;
}> {
  const wanted = <T,>(module: ModuleId, run: () => Promise<T>): Promise<T | null> =>
    enabled.includes(module) ? run().catch(() => null) : Promise.resolve(null);

  const [items, pursuits, notes, tasks] = await Promise.all([
    wanted('shopping', async () => {
      const supabase = await createClient();
      const { count } = await supabase
        .from('inventory_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
      return count ?? 0;
    }),
    wanted('jobs', async () => {
      const supabase = await createJobsClient();
      const { count } = await supabase
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`);
      return count ?? 0;
    }),
    wanted('vault', async () => {
      const supabase = await createVaultClient();
      const { count } = await supabase
        .from('notes')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('deleted_at', null);
      return count ?? 0;
    }),
    wanted('todo', async () => {
      const { countOpenTasks } = await import('@/lib/todo/tasks/load');
      return countOpenTasks(userId);
    }),
  ]);

  return { items, pursuits, notes, tasks };
}

function ModuleCard({
  href,
  icon: Icon,
  title,
  stat,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  stat: string;
}) {
  return (
    <Link
      href={href}
      className="lift flex items-center gap-4 rounded-card border border-border bg-surface p-5"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-tint">
        <Icon className="size-5 text-brand" strokeWidth={1.75} />
      </span>
      <span>
        <span className="block text-[15px] font-semibold text-ink">{title}</span>
        <span className="tabular block text-[13px] text-ink-muted">{stat}</span>
      </span>
    </Link>
  );
}
