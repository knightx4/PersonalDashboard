import Link from 'next/link';
import { Briefcase, LayoutGrid, ListChecks, NotebookText, ShoppingBag } from 'lucide-react';
import { requireUser, createClient } from '@/lib/auth/server';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import { MODULES, type ModuleId } from '@/lib/modules';
import { TERMINAL_STATUSES } from '@/lib/jobs/pipeline';
import { FeedbackButton } from '@/components/shell/feedback-button';
import { NotificationsButton } from '@/components/shell/notifications-button';
import { WorkspaceSwitcher } from '@/components/shell/workspace-switcher';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { countOpenTasks } from '@/lib/todo/tasks/load';
import { loadAgenda } from '@/lib/todo/agenda/load';
import { BUCKET_LABELS } from '@/lib/todo/tasks/model';

export const metadata = { title: 'Home' };

/**
 * The front door to the account, not to either module.
 *
 * One account now does several unrelated things, and none should have to
 * stand in for another's landing page. This is where onboarding and a
 * signed-in visit to `/` both end up; each tile goes straight into that
 * module rather than by way of another menu.
 *
 * The tiles come from lib/modules.ts, the same list the workspace switcher
 * uses, so a module added there appears here too -- with a count if one is
 * written below, and its description if not. The vault was added to the
 * switcher and missed here, which is the bug this arrangement removes.
 *
 * Above the tiles: the two or three things that actually need today. That is
 * the one question none of the modules can answer on its own, and it is what
 * this page was missing -- it showed counts, which is news about the account
 * rather than anything to do. A front door showing forty rows would be a list,
 * and /todo is already the list.
 *
 * A module switched off under Account is not listed. That is what the switch
 * means, and a tile for a hidden module would make it a lie.
 */
export default async function HomePage() {
  const user = await requireUser();
  const settings = await loadAccountSettings(user.id);

  const supabase = await createClient();
  const jobs = await createJobsClient();

  const vault = await createVaultClient();

  const [
    { count: itemCount },
    { count: pursuitCount },
    { count: noteCount },
    taskCount,
    agenda,
  ] = await Promise.all([
    supabase
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
    jobs
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`),
    // RLS scopes this to the signed-in user, and an unconnected vault is
    // simply zero rather than an error.
    vault.from('notes').select('id', { count: 'exact', head: true }),
    countOpenTasks(user.id),
    // The agenda reads three schemas; a failure in any of them must cost this
    // page a section, not the whole front door.
    loadAgenda(user.id).catch(() => null),
  ]);

  const plural = (count: number | null, one: string, many = `${one}s`) =>
    `${count ?? 0} ${count === 1 ? one : many}`;

  /** A module with no line written here falls back to its description. */
  const STATS: Partial<Record<ModuleId, string>> = {
    shopping: plural(itemCount, 'item') + ' tracked',
    jobs: plural(pursuitCount, 'open pursuit'),
    vault: plural(noteCount, 'note') + ' mirrored',
    todo: plural(taskCount, 'thing') + ' to do',
  };

  // Partial, with a generic fallback: a module added to the list must never
  // fail to render because nobody has chosen its icon yet.
  const ICONS: Partial<
    Record<ModuleId, React.ComponentType<{ className?: string; strokeWidth?: number }>>
  > = {
    shopping: ShoppingBag,
    jobs: Briefcase,
    vault: NotebookText,
    todo: ListChecks,
  };

  // Overdue and today only, capped. Everything else is a page away.
  const due = (agenda?.piles ?? [])
    .filter((pile) => pile.bucket === 'overdue' || pile.bucket === 'today')
    .flatMap((pile) => pile.entries.map((entry) => ({ bucket: pile.bucket, entry })))
    .slice(0, 4);

  const displayName = settings.displayName;
  const initial = (displayName || user.email || '').charAt(0).toUpperCase();

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
          <WorkspaceSwitcher current={null} enabled={settings.enabledModules} />
          <div className="flex-1" />
          <NotificationsButton />
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
            insists on saying something is one people stop reading. */}
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
              {due.map(({ bucket, entry }) => (
                <li key={entry.key} className="flex items-baseline gap-2 py-1.5">
                  {bucket === 'overdue' && (
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
          {MODULES.filter((module) => moduleEnabled(settings, module.id)).map((module) => (
            <ModuleCard
              key={module.id}
              href={module.home}
              icon={ICONS[module.id] ?? LayoutGrid}
              title={module.label}
              stat={STATS[module.id] ?? module.description}
            />
          ))}
        </div>
      </main>
    </div>
  );
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
