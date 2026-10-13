import { Fingerprint, GraduationCap, MapPin, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * What each of You's four tabs says before anything is in it (plan #1991.1).
 *
 * Kept in one table and drawn by one component so the pages and the gallery
 * entry show the same words. Each later step under #1991 replaces one tab's
 * page with the real thing and its row here goes.
 */
export type YouTab = 'personality' | 'places' | 'work' | 'insights';

type TabCopy = {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  emptyTitle: string;
  emptyDescription: string;
  /** Where the thing lives today, while it has not moved here yet. */
  action?: { label: string; href: string };
};

export const YOU_TABS: Record<YouTab, TabCopy> = {
  personality: {
    title: 'Personality',
    description: 'Your test results, and what Dash reads in them',
    icon: Fingerprint,
    emptyTitle: 'Your results are still in Learn',
    emptyDescription:
      'Your Big Five test, the types you got elsewhere and Dash’s read of each are moving here. Until then they are on Learn’s Know page.',
    action: { label: 'Open them in Learn', href: '/learn/know/personality' },
  },
  places: {
    title: 'Places',
    description: 'Where you have lived',
    icon: MapPin,
    emptyTitle: 'No places yet',
    emptyDescription:
      'The places you have lived will be listed here, newest first, with the one you live in now marked.',
  },
  work: {
    title: 'Work & school',
    description: 'The jobs you have held and the courses you have taken',
    icon: GraduationCap,
    emptyTitle: 'Nothing here yet',
    emptyDescription:
      'Your jobs, read from your résumé in Jobs, and your transcripts and courses will be listed here. Your transcripts are in the Vault until they move.',
    action: { label: 'Open Education in the Vault', href: '/vault/education' },
  },
  insights: {
    title: 'Insights',
    description: 'What Dash notices about you',
    icon: Sparkles,
    emptyTitle: 'Nothing noticed yet',
    emptyDescription:
      'When Dash notices something about you across your notes, tests and history, it will be written here with what it rests on.',
  },
};

export function YouTabEmpty({ tab }: { tab: YouTab }) {
  const copy = YOU_TABS[tab];
  return (
    <>
      <PageHeader title={copy.title} description={copy.description} />
      <EmptyState
        icon={copy.icon}
        title={copy.emptyTitle}
        description={copy.emptyDescription}
        action={copy.action}
      />
    </>
  );
}
