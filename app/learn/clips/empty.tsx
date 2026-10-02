import { Clapperboard } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';

/** Clips before any are cut: the cutting runs on the library ticks, so say that and point at Learn now. */
export function ClipsEmpty() {
  return (
    <>
      <PageHeader title="Clips" />
      <EmptyState
        icon={Clapperboard}
        title="No clips yet"
        description="Dash is cutting short clips from your videos, each making one point, a few times a day. The first ones play here once they are cut and scored."
        action={{ label: 'Go to Learn now', href: '/learn/now' }}
      />
    </>
  );
}
