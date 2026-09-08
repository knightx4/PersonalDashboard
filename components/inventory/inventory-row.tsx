'use client';

import Link from 'next/link';
import { RotateCcw, Tag } from 'lucide-react';
import {
  InventoryRowActions,
  type InventoryListOption,
} from '@/components/inventory/inventory-row-actions';
import { InventoryRowCheckbox } from '@/components/inventory/inventory-selection';
import { CategoryGlyph } from '@/lib/categories/icons';
import { formatMoney } from '@/lib/money';
import { displayNameOf } from '@/lib/inventory/sort-group';
import { displayVariant } from '@/lib/inventory/display';
import { cn } from '@/lib/cn';
import { PersonBadge } from '@/components/people/person-badge';
import type { Person } from '@/lib/people/load';
import { UNSET_SWATCH } from '@/lib/lists/gradients';

export type InventoryRowItem = {
  id: string;
  name: string;
  short_name: string | null;
  variant: string | null;
  cost_cents: number;
  acquired_at: string | null;
  image_url: string | null;
  return_planned: boolean;
  for_sale: boolean;
  category_name: string | null;
  category_color: string | null;
  category_slug: string | null;
  merchant_name: string | null;
  list_ids?: string[];
  /** Whose item this is. Null on a one-person account, and on old data. */
  person?: Person | null;
  /**
   * How many copies of this item the row stands for. Absent or 1 for almost
   * everything; see lib/inventory/item-groups.ts.
   */
  quantity?: number;
  /** What one copy cost. Equal ends when the copies agree, which is the norm. */
  unit_cost_low?: number;
  unit_cost_high?: number;
  /**
   * Every copy's id. The checkbox ticks the whole stack, because "mark for
   * sale" said to a row showing three copies means all three.
   */
  unit_ids?: string[];
};

export function InventoryRow({
  item,
  lists = [],
}: {
  item: InventoryRowItem;
  lists?: InventoryListOption[];
}) {
  const title = displayNameOf(item);
  const variant = displayVariant(item.variant);
  const accent = item.category_color ?? UNSET_SWATCH;
  const quantity = item.quantity ?? 1;
  const low = item.unit_cost_low ?? item.cost_cents;
  const high = item.unit_cost_high ?? item.cost_cents;
  // `cost_cents` on a stacked row is the whole stack, so the per-copy figure
  // comes from the range. A range only when the copies really did cost
  // different amounts — calling any one of them "the price" otherwise.
  const unitLabel =
    low === high ? formatMoney(low) : `${formatMoney(low)}–${formatMoney(high)}`;

  return (
    <li className="group flex items-stretch hover:bg-canvas">
      <InventoryRowCheckbox
        id={item.id}
        ids={item.unit_ids}
        label={quantity > 1 ? `${title} (${quantity} copies)` : title}
      />
      <Link
        href={`/shopping/inventory/${item.id}`}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 pr-2 transition-colors duration-150',
          'focus-visible:bg-canvas focus-visible:outline-none',
        )}
      >
        <span
          className="relative size-11 shrink-0 overflow-hidden rounded-lg border border-border bg-canvas"
          style={{ boxShadow: `inset 3px 0 0 ${accent}` }}
        >
          {item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary merchant CDNs
            <img
              src={item.image_url}
              alt=""
              className="size-full object-cover transition-transform duration-200"
            />
          ) : (
            <span className="flex size-full items-center justify-center text-ink-muted">
              <CategoryGlyph slug={item.category_slug} className="size-4" />
            </span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">
            {title}
            <PersonBadge person={item.person} className="ml-2 align-middle" />
            {item.return_planned && (
              <span className="ml-2 inline-flex items-center gap-1 align-middle text-micro font-semibold uppercase tracking-wide text-accent">
                <RotateCcw className="size-3" strokeWidth={2} aria-hidden />
                To return
              </span>
            )}
            {item.for_sale && (
              <span className="ml-2 inline-flex items-center gap-1 align-middle text-micro font-semibold uppercase tracking-wide text-caution">
                <Tag className="size-3" strokeWidth={2} aria-hidden />
                For sale
              </span>
            )}
          </p>
          <p className="truncate text-ui text-ink-muted">
            {[item.merchant_name, variant, item.acquired_at].filter(Boolean).join(' · ')}
          </p>
        </div>

        {/* Category has its own column rather than sitting under the price:
            they are unrelated facts, and stacking them read as though the
            category were a caption on the number. */}
        <div className="hidden w-28 shrink-0 sm:block">
          {item.category_name && (
            <span className="inline-flex items-center gap-1 truncate text-small text-ink-muted">
              <CategoryGlyph slug={item.category_slug} className="size-3 shrink-0" />
              <span className="truncate">{item.category_name}</span>
            </span>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <p className="tabular font-medium text-ink">
            {unitLabel}
            {quantity > 1 && (
              <span className="ml-1.5 rounded bg-sunken px-1.5 py-0.5 text-micro font-semibold text-ink-muted">
                ×{quantity}
              </span>
            )}
          </p>
          {quantity > 1 && (
            <p className="tabular text-small text-ink-muted">
              {formatMoney(item.cost_cents)} total
            </p>
          )}
        </div>
      </Link>

      <div className="flex shrink-0 items-center pr-1.5 sm:pr-2">
        <InventoryRowActions
          itemId={item.id}
          itemName={title}
          returnPlanned={item.return_planned}
          forSale={item.for_sale}
          listIds={item.list_ids ?? []}
          lists={lists}
        />
      </div>
    </li>
  );
}

export function InventoryImageFallback({
  categorySlug,
  className,
}: {
  categorySlug?: string | null;
  className?: string;
}) {
  return (
    <span className={cn('flex items-center justify-center bg-canvas text-ink-muted', className)}>
      <CategoryGlyph slug={categorySlug} className="size-8" strokeWidth={1.75} />
    </span>
  );
}
