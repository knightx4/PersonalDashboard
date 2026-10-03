import { Clapperboard } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * The Clips section of Videos before any are cut: the cutting runs on the
 * library ticks, so say that and point at Now.
 */
export function ClipsEmpty() {
  return (
    <EmptyState
      icon={Clapperboard}
      title="No clips yet"
      description="Dash is cutting short clips from your videos, each making one point, a few times a day. The first ones play here once they are cut and scored."
      action={{ label: 'Go to Now', href: '/learn/now' }}
    />
  );
}
