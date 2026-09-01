import Link from 'next/link';
import { Briefcase, ShoppingBag } from 'lucide-react';
import { requireUser, createClient } from '@/lib/auth/server';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { TERMINAL_STATUSES } from '@/lib/jobs/pipeline';

export const metadata = { title: 'Home' };

/**
 * The front door to the account, not to either module.
 *
 * One account now does two unrelated things, and neither should have to
 * stand in for the other's landing page. This is where onboarding and a
 * signed-in visit to `/` both end up; each tile goes straight into that
 * module rather than by way of another menu.
 */
export default async function HomePage() {
  const user = await requireUser();
  const supabase = await createClient();
  const jobs = await createJobsClient();

  const [{ count: itemCount }, { count: pursuitCount }] = await Promise.all([
    supabase
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
    jobs
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`),
  ]);

  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Home</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <ModuleCard
          href="/shopping/dashboard"
          icon={ShoppingBag}
          title="Shopping"
          stat={`${itemCount ?? 0} item${itemCount === 1 ? '' : 's'} tracked`}
        />
        <ModuleCard
          href="/jobs/today"
          icon={Briefcase}
          title="Job search"
          stat={`${pursuitCount ?? 0} open pursuit${pursuitCount === 1 ? '' : 's'}`}
        />
      </div>
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
