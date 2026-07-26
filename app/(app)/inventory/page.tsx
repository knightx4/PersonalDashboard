import { Package } from 'lucide-react';
import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/field';
import { formatMoney } from '@/lib/money';

export const metadata = { title: 'Inventory' };

function inventoryHref(opts: { q?: string; category?: string }): string {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.category) params.set('category', opts.category);
  const qs = params.toString();
  return qs ? `/inventory?${qs}` : '/inventory';
}

/** Everything currently owned: inventory_items where status is 'owned'. */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;
  // Strip PostgREST filter metacharacters so a typed comma cannot widen the OR.
  const q = (params.q ?? '').trim().replace(/[%_,*()]/g, ' ').replace(/\s+/g, ' ').trim();
  const categoryId = params.category?.trim() || undefined;

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, color')
    .is('parent_id', null)
    .order('name');

  let query = supabase
    .from('inventory_items')
    .select(
      'id, name, variant, cost_cents, acquired_at, status, category_id, categories(name, color)',
    )
    .eq('user_id', user.id)
    .eq('status', 'owned')
    .order('acquired_at', { ascending: false });

  if (categoryId) query = query.eq('category_id', categoryId);
  if (q) query = query.or(`name.ilike.%${q}%,variant.ilike.%${q}%`);

  const { data: items, error } = await query;
  if (error) throw error;

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <LeftRail>
        <RailGroup label="Category">
          <RailItem label="All" active={!categoryId} href={inventoryHref({ q })} />
          {(categories ?? []).map((category) => (
            <RailItem
              key={category.id}
              label={category.name}
              swatch={category.color ?? undefined}
              active={category.id === categoryId}
              href={inventoryHref({ q, category: category.id })}
            />
          ))}
        </RailGroup>
      </LeftRail>

      <div className="min-w-0 flex-1">
        <PageHeader
          title="Inventory"
          description="Everything you currently own, so you can check before buying it again."
        />

        <form className="mb-5" action="/inventory" method="get">
          {categoryId && <input type="hidden" name="category" value={categoryId} />}
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search what you own…"
            aria-label="Search inventory"
          />
        </form>

        {(items ?? []).length === 0 ? (
          <EmptyState
            icon={Package}
            title={q || categoryId ? 'No matching items' : 'Nothing in your inventory yet'}
            description={
              q || categoryId
                ? 'Try a different search or category.'
                : 'Every item from an order lands here as its own entry, so you can search what you own, mark things returned, or record that you got rid of them.'
            }
            action={
              q || categoryId
                ? { label: 'Clear filters', href: '/inventory' }
                : { label: 'Add an order', href: '/orders/new' }
            }
            secondaryAction={
              q || categoryId ? undefined : { label: 'Connect an inbox', href: '/settings' }
            }
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {items!.map((item) => {
              const category = Array.isArray(item.categories)
                ? item.categories[0]
                : item.categories;
              return (
                <li key={item.id}>
                  <Link
                    href={`/inventory/${item.id}`}
                    className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-canvas"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: category?.color ?? '#cfcfc8' }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{item.name}</p>
                      <p className="truncate text-[13px] text-ink-muted">
                        {[item.variant, category?.name, item.acquired_at]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <p className="tabular shrink-0 font-medium text-ink">
                      {formatMoney(item.cost_cents)}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
