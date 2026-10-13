import { Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { PageColumn } from '@/components/shell/page-width';

/**
 * What each of You's four tabs says before anything is in it (plan #1991.1).
 *
 * Kept in one table and drawn by one component so the pages and the gallery
 * entry show the same words. Each later step under #1991 replaces one tab's
 * page with the real thing and its row here goes.
 */
export type YouTab = 'insights';

type TabCopy = {
  title: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  emptyTitle: string;
  emptyDescription: string;
  /** Where the thing lives today, while it has not moved here yet. */
  action?: { label: string; href: string };
};

export const YOU_TABS: Record<YouTab, TabCopy> = {
  insights: {
    title: 'Insights',
    icon: Sparkles,
    emptyTitle: 'Nothing noticed yet',
    emptyDescription:
      'When Dash notices something about you across your notes, tests and history, it will be written here with what it rests on.',
  },
};

export function YouTabEmpty({ tab }: { tab: YouTab }) {
  const copy = YOU_TABS[tab];
  return (
    <PageColumn>
      <PageHeader title={copy.title} />
      <EmptyState
        icon={copy.icon}
        title={copy.emptyTitle}
        description={copy.emptyDescription}
        action={copy.action}
      />
    </PageColumn>
  );
}
