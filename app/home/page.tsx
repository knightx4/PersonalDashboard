import Link from 'next/link';
import { Briefcase, LayoutGrid, NotebookText, ShoppingBag } from 'lucide-react';
import { requireUser, createClient } from '@/lib/auth/server';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import { MODULES, type ModuleId } from '@/lib/modules';
import { TERMINAL_STATUSES } from '@/lib/jobs/pipeline';
import { FeedbackButton } from '@/components/shell/feedback-button';
import { NotificationsButton } from '@/components/shell/notifications-button';
import { WorkspaceSwitcher } from '@/components/shell/workspace-switcher';

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
 */
export default async function HomePage() {
  const user = await requireUser();
  const supabase = await createClient();
  const jobs = await createJobsClient();

  const vault = await createVaultClient();

  const [{ count: itemCount }, { count: pursuitCount }, { count: noteCount }, { data: profile }] =
    await Promise.all([
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
      supabase.from('profiles').select('display_name').eq('id', user.id).single(),
    ]);

  const plural = (count: number | null, one: string, many = `${one}s`) =>
    `${count ?? 0} ${count === 1 ? one : many}`;

  /** A module with no line written here falls back to its description. */
  const STATS: Partial<Record<ModuleId, string>> = {
    shopping: plural(itemCount, 'item') + ' tracked',
    jobs: plural(pursuitCount, 'open pursuit'),
    vault: plural(noteCount, 'note') + ' mirrored',
  };

  // Partial, with a generic fallback: a module added to the list must never
  // fail to render because nobody has chosen its icon yet.
  const ICONS: Partial<
    Record<ModuleId, React.ComponentType<{ className?: string; strokeWidth?: number }>>
  > = {
    shopping: ShoppingBag,
    jobs: Briefcase,
    vault: NotebookText,
  };

  const displayName = profile?.display_name ?? null;
  const initial = (displayName || user.email || '').charAt(0).toUpperCase();

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
          <WorkspaceSwitcher current={null} />
          <div className="flex-1" />
          <NotificationsButton />
          <FeedbackButton />
          <Link
            href="/shopping/settings"
            className="press flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[13px] font-semibold text-brand"
            title={displayName ?? user.email ?? ''}
          >
            {initial}
            <span className="sr-only">Account and settings</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Home</h1>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {MODULES.map((module) => (
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
