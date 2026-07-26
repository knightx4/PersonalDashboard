import { Package } from 'lucide-react';
import { createClient, requireUser } from '@/lib/auth/server';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata = { title: 'Inventory' };

/** Everything currently owned: inventory_items where status is 'owned'. */
export default async function InventoryPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ count }, { data: categories }] = await Promise.all([
    supabase
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'owned'),
    supabase
      .from('categories')
      .select('id, name, color')
      .is('parent_id', null)
      .order('name'),
  ]);

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <LeftRail>
        <RailGroup label="Category">
          {(categories ?? []).map((category) => (
            <RailItem
              key={category.id}
              label={category.name}
              swatch={category.color ?? undefined}
            />
          ))}
        </RailGroup>
        <RailGroup label="Acquired">
          <RailItem label="Any time" active />
          <RailItem label="Last 30 days" />
          <RailItem label="Last 12 months" />
        </RailGroup>
      </LeftRail>

      <div className="min-w-0 flex-1">
        <PageHeader
          title="Inventory"
          description="Everything you currently own, so you can check before buying it again."
        />

        {count ? (
          <p className="text-sm text-ink-muted">{count} items owned. The grid arrives with build step 6.</p>
        ) : (
          <EmptyState
            icon={Package}
            title="Nothing in your inventory yet"
            description="Every item from an order lands here as its own entry, so you can search what you own, mark things returned, or record that you got rid of them."
            action={{ label: 'Connect an inbox', href: '/settings/email' }}
            secondaryAction={{ label: 'Add an order', href: '/orders/new' }}
          />
        )}
      </div>
    </div>
  );
}
