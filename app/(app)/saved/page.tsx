import { Bookmark } from 'lucide-react';
import { createClient, requireUser } from '@/lib/auth/server';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata = { title: 'Saved' };

export default async function SavedPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { count } = await supabase
    .from('saved_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'saved');

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <LeftRail>
        <RailGroup label="Status">
          <RailItem label="Saved" active />
          <RailItem label="Purchased" />
          <RailItem label="Dismissed" />
        </RailGroup>
      </LeftRail>

      <div className="min-w-0 flex-1">
        <PageHeader
          title="Saved"
          description="Things you want, held in a queue instead of a cart."
        />

        {count ? (
          <p className="text-sm text-ink-muted">{count} saved. The grid arrives with build step 8.</p>
        ) : (
          <EmptyState
            icon={Bookmark}
            title="Nothing saved yet"
            description="Paste a product URL and we will pull in the title, image and price. If you buy it later, from anywhere, we will notice and tick it off."
            action={{ label: 'Save something', href: '/saved/new' }}
          />
        )}
      </div>
    </div>
  );
}
