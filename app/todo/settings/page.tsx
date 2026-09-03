import Link from 'next/link';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { loadAgendaSettings } from '@/lib/todo/agenda/settings';
import { allSources } from '@/lib/todo/agenda/registry';
import { PageHeader } from '@/components/shell/page-header';
import { AgendaSettingsForm } from './view';

export const metadata = { title: 'Todo settings' };

/**
 * This workspace's own settings: what feeds the agenda, and how far it looks.
 *
 * Both would be meaningless with the module switched off, which is the test for
 * what belongs here rather than under Account. Your name, timezone and currency
 * are one link away and are not repeated.
 */
export default async function TodoSettingsPage() {
  const user = await requireUser();
  const [account, agenda] = await Promise.all([
    loadAccountSettings(user.id),
    loadAgendaSettings(user.id),
  ]);

  const sources = allSources().map((source) => ({
    id: source.id,
    label: source.label,
    description: source.description,
    // A source whose workspace is off cannot be switched on here. Turning off a
    // workspace has to mean it stops appearing, and a settings page that lets
    // you contradict that is a settings page that lies.
    available: moduleEnabled(account, source.module),
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Todo settings"
        description="What this workspace does. Your name and timezone are under Account."
      />

      <AgendaSettingsForm
        sources={sources}
        enabled={agenda.enabledSources}
        horizonDays={agenda.horizonDays}
      />

      <p className="mt-6 text-[13px] text-ink-muted">
        Your timezone decides what counts as today here, and it holds across every workspace.{' '}
        <Link href="/account" className="font-medium text-brand underline underline-offset-2">
          Account settings
        </Link>
      </p>
    </div>
  );
}
