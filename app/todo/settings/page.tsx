import Link from 'next/link';
import { requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';

export const metadata = { title: 'Todo settings' };

/**
 * This workspace's own settings.
 *
 * Almost empty on purpose, and honest about it. What belongs here are the
 * settings that would be meaningless with the module switched off -- the
 * agenda's horizon and which sources feed it -- and the sources do not exist
 * yet. Your name, timezone and currency are account settings and are one link
 * away.
 */
export default async function TodoSettingsPage() {
  await requireUser();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Todo settings"
        description="What this workspace does. Your name and timezone are under Account."
      />

      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">Sources</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          The agenda will be able to show things the other workspaces already know about — a
          follow-up the job search is waiting on, a return window about to close — without
          copying them here. Nothing is switched on yet.
        </p>
      </section>

      <section className="mt-4 rounded-card border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">Account</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Your timezone decides what counts as today on the agenda, and it holds across every
          workspace.
        </p>
        <Link
          href="/account"
          className="mt-2 inline-block text-[13px] font-medium text-brand underline underline-offset-2"
        >
          Account settings
        </Link>
      </section>
    </div>
  );
}
