import { Mail } from 'lucide-react';
import { requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata = { title: 'Newsletters' };

/**
 * The workspace's one page, and for now only its empty state.
 *
 * The list itself is plan #452 and the address you sign up with is #451, so
 * until those land there is nothing to draw. It exists this early because the
 * switcher and the home tile both link here, and a workspace that 404s is
 * worse than one that says what is coming.
 */
export default async function NewsPage() {
  await requireUser();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Newsletters"
        description="What has been sent to the address that belongs to this app."
      />
      <EmptyState
        icon={Mail}
        title="Nothing has arrived yet"
        description="Mail sent to this workspace's own address is delivered straight here. The address, and the list of what it has been sent, are still being built."
      />
    </div>
  );
}
