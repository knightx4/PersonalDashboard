import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import {
  InventoryRowActions,
  type InventoryListOption,
} from '@/components/inventory/inventory-row-actions';
import { CategoryGlyph } from '@/lib/categories/icons';
import { formatMoney } from '@/lib/money';
import { displayNameOf } from '@/lib/inventory/sort-group';
import { displayVariant } from '@/lib/inventory/display';
import { cn } from '@/lib/cn';

export type InventoryRowItem = {
  id: string;
  name: string;
  short_name: string | null;
  variant: string | null;
  cost_cents: number;
  acquired_at: string | null;
  image_url: string | null;
  return_planned: boolean;
  category_name: string | null;
  category_color: string | null;
  category_slug: string | null;
  merchant_name: string | null;
  list_ids?: string[];
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
  const accent = item.category_color ?? '#cfcfc8';

  return (
    <li className="group flex items-stretch hover:bg-canvas">
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
              className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
            />
          ) : (
            <span className="flex size-full items-center justify-center text-ink-faint">
              <CategoryGlyph slug={item.category_slug} className="size-4" />
            </span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">
            {title}
            {item.return_planned && (
              <span className="ml-2 inline-flex items-center gap-1 align-middle text-[11px] font-semibold uppercase tracking-wide text-brand">
                <RotateCcw className="size-3" strokeWidth={2} aria-hidden />
                To return
              </span>
            )}
          </p>
          <p className="truncate text-[13px] text-ink-muted">
            {[item.merchant_name, variant, item.acquired_at].filter(Boolean).join(' · ')}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="tabular font-medium text-ink">{formatMoney(item.cost_cents)}</p>
          {item.category_name && (
            <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint">
              <CategoryGlyph slug={item.category_slug} className="size-3" />
              {item.category_name}
            </span>
          )}
        </div>
      </Link>

      <div className="flex shrink-0 items-center pr-1.5 sm:pr-2">
        <InventoryRowActions
          itemId={item.id}
          itemName={title}
          returnPlanned={item.return_planned}
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
    <span className={cn('flex items-center justify-center bg-canvas text-ink-faint', className)}>
      <CategoryGlyph slug={categorySlug} className="size-8" strokeWidth={1.5} />
    </span>
  );
}
