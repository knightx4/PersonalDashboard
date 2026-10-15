import { InboxPage, type InboxRow } from '@/components/inbox/inbox-page';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { Banner } from '@/components/ui/banner';
import { ModuleMark } from '@/components/ui/module-mark';
import type { ModuleId } from '@/lib/modules';

/**
 * Home's Inbox (plan #1937.7): every workspace's on-you rows on one page,
 * a group to each workspace under its mark, in the switcher's order. Drawn
 * the same by /home/inbox and its gallery surface.
 */

export type HomeInboxViewGroup = {
  workspace: ModuleId;
  label: string;
  href: string;
  rows: readonly InboxRow[];
};

export function HomeInboxView({
  groups,
  failed = [],
}: {
  groups: readonly HomeInboxViewGroup[];
  /** What could not be read just now, named so a short list is not taken for a quiet one. */
  failed?: readonly string[];
}) {
  return (
    <PageColumn className="space-y-6">
      <PageHeader title="Inbox" />
      {failed.length > 0 && (
        <Banner tone="bad">
          {failed.join(' and ')} could not be read just now, so anything from{' '}
          {failed.length > 1 ? 'them' : 'it'} is missing here.
        </Banner>
      )}
      <InboxPage
        rows={groups.flatMap((group) => group.rows.map((row) => ({ ...row, group: group.workspace })))}
        groups={groups.map((group) => ({
          key: group.workspace,
          title: group.label,
          href: group.href,
          mark: <ModuleMark module={group.workspace} size="xs" />,
        }))}
        empty={{
          title: 'Nothing is waiting on you',
          description: 'Anything in any workspace that needs you shows here, under that workspace.',
        }}
      />
    </PageColumn>
  );
}
