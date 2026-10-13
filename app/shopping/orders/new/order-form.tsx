'use client';

import { useActionState, useMemo, useState } from 'react';
import { CalendarDays, Hash, Trash2, User } from 'lucide-react';
import { createManualOrder, type ActionState } from '@/app/shopping/orders/actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AddTrigger } from '@/components/ui/add-trigger';
import {
  ChipInput,
  ChipSelect,
  FieldError,
  InlineInput,
  InlineTextarea,
} from '@/components/ui/field';
import type { Person } from '@/lib/people/load';
import type { OrderFormPrefill } from '@/lib/review/read-order';
import {
  computeOrderTotalCents,
  formatMoney,
  orderSubtotalCents,
  parseDollarsToCents,
} from '@/lib/money';
import { MerchantField } from './merchant-field';
import type { MerchantOption } from '@/lib/merchants/suggest';
import { Tooltip } from '@/components/ui/tooltip';

interface CategoryOption {
  id: string;
  name: string;
}

interface LineDraft {
  key: string;
  name: string;
  variant: string;
  quantity: string;
  unitPrice: string;
  categoryId: string;
}

const initialState: ActionState = {};

/*
 * The line items' columns. On a phone: variant, category, quantity, the
 * times sign and price, with the name spanning the first four above them
 * and the bin over the price. From sm: name, variant, category, quantity,
 * times, price and bin on one row, the bin straight after the price.
 */
const LINE_GRID =
  'grid-cols-[minmax(0,1fr)_auto_2.75rem_auto_4.75rem] sm:grid-cols-[minmax(0,4fr)_minmax(0,2fr)_minmax(0,2fr)_3rem_auto_6rem_2rem] sm:gap-x-2';

function newLine(): LineDraft {
  return {
    key: crypto.randomUUID(),
    name: '',
    variant: '',
    quantity: '1',
    unitPrice: '',
    categoryId: '',
  };
}

function safeCents(value: string): number {
  try {
    return parseDollarsToCents(value);
  } catch {
    return 0;
  }
}

export function OrderForm({
  merchants,
  categories,
  defaultDate,
  people = [],
  defaultPersonId = null,
  prefill = null,
  sourceMessageId = null,
}: {
  merchants: MerchantOption[];
  categories: CategoryOption[];
  defaultDate: string;
  people?: Person[];
  defaultPersonId?: string | null;
  /** Starting values read out of an email. */
  prefill?: OrderFormPrefill | null;
  /** The review email the order is made from; saving links it to the order. */
  sourceMessageId?: string | null;
}) {
  const [state, action, pending] = useActionState(createManualOrder, initialState);
  const [lines, setLines] = useState<LineDraft[]>(() =>
    prefill && prefill.lines.length > 0
      ? prefill.lines.map((line) => ({ ...line, key: crypto.randomUUID() }))
      : [newLine()],
  );
  const [tax, setTax] = useState(prefill?.tax ?? '');
  const [shipping, setShipping] = useState(prefill?.shipping ?? '');
  const [discount, setDiscount] = useState(prefill?.discount ?? '');

  const preview = useMemo(() => {
    const pricedLines = lines.flatMap((line) => {
      const qty = Number.parseInt(line.quantity, 10);
      if (!Number.isInteger(qty) || qty < 1) return [];
      return [{ quantity: qty, unitPriceCents: safeCents(line.unitPrice) }];
    });
    const subtotalCents = orderSubtotalCents(pricedLines);
    const taxCents = safeCents(tax);
    const shippingCents = safeCents(shipping);
    const discountCents = safeCents(discount);
    const totalCents = computeOrderTotalCents({
      subtotalCents,
      taxCents,
      shippingCents,
      discountCents,
    });
    return { subtotalCents, totalCents };
  }, [lines, tax, shipping, discount]);

  const setLine = (index: number, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  /*
   * A compose surface rather than a form (law 12): the shop is the title line,
   * the date, order number and whose it is are chips beneath it, each line
   * item is one row of values with the column names said once, and tax,
   * shipping and discount sit in the sum they change. The field names are the
   * ones createManualOrder has always read, so the action is unchanged.
   */
  return (
    <form action={action} className="space-y-6">
      {sourceMessageId && <input type="hidden" name="source_message_id" value={sourceMessageId} />}
      {prefill && <input type="hidden" name="currency" value={prefill.currency} />}

      <Card padding="dense" className="space-y-2">
        <MerchantField
          id="merchant"
          compose
          merchants={merchants}
          defaultValue={
            prefill
              ? (merchants.find((merchant) => merchant.id === prefill.merchantId)?.name ??
                prefill.merchantName)
              : undefined
          }
        />
        <div className="-ml-1.5 flex flex-wrap items-center gap-1">
          <ChipInput
            icon={<CalendarDays className="size-3.5" strokeWidth={1.75} />}
            name="order_date"
            type="date"
            required
            aria-label="Order date"
            defaultValue={prefill?.orderDate ?? defaultDate}
          />
          <ChipInput
            icon={<Hash className="size-3.5" strokeWidth={1.75} />}
            name="external_order_number"
            aria-label="Order number"
            placeholder="Order number"
            defaultValue={prefill?.externalOrderNumber}
          />
          {/*
            Only shown once there is somebody to choose between. On a
            single-person account this is a question with one answer, and
            asking it every time would be noise.
          */}
          {people.length > 1 && (
            <ChipSelect
              icon={<User className="size-3.5" strokeWidth={1.75} />}
              name="person_id"
              aria-label="Whose is it"
              placeholderValue=""
              defaultValue={defaultPersonId ?? ''}
            >
              <option value="">Nobody in particular</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </ChipSelect>
          )}
        </div>
      </Card>

      <section>
        <h2 className="text-ui font-semibold text-ink">What you bought</h2>
        {/* The column names, once, where there is room for columns. The
         * figures and their names are right-aligned, so a price reads down
         * its column. */}
        <div
          aria-hidden
          className={`mt-2 hidden px-1 text-small text-ink-muted sm:grid ${LINE_GRID}`}
        >
          <span>Item</span>
          <span>Variant</span>
          <span>Category</span>
          <span className="text-right">Qty</span>
          <span />
          <span className="text-right">Unit price</span>
        </div>
        {/*
         * Two lines per item on a phone: the name with its bin, then the
         * variant, category and quantity times price, which read as one
         * phrase ("Navy, M · Clothing · 1 × 49.90"). From sm up the same
         * cells sit on one row under the column names.
         */}
        <ul className="mt-1 divide-y divide-border border-y border-border">
          {lines.map((line, index) => (
            <li key={line.key} className={`row-pad grid items-center gap-x-1 ${LINE_GRID}`}>
              <InlineTextarea
                name="line_name"
                required
                aria-label="Item"
                placeholder="What did you buy?"
                className="col-span-4 col-start-1 row-start-1 max-sm:py-2.5 sm:col-span-1"
                value={line.name}
                onChange={(event) => setLine(index, { name: event.target.value })}
              />
              <InlineInput
                name="line_variant"
                aria-label="Variant"
                placeholder="Size, colour…"
                className="col-start-1 row-start-2 sm:col-start-2 sm:row-start-1"
                value={line.variant}
                onChange={(event) => setLine(index, { variant: event.target.value })}
              />
              <ChipSelect
                name="line_category_id"
                aria-label="Category"
                placeholderValue=""
                className="col-start-2 row-start-2 sm:col-start-3 sm:row-start-1"
                value={line.categoryId}
                onChange={(event) => setLine(index, { categoryId: event.target.value })}
              >
                <option value="">Uncategorized</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </ChipSelect>
              <InlineInput
                name="line_quantity"
                inputMode="numeric"
                required
                aria-label="Quantity"
                className="tabular col-start-3 row-start-2 text-right sm:col-start-4 sm:row-start-1"
                value={line.quantity}
                onChange={(event) => setLine(index, { quantity: event.target.value })}
              />
              <span
                aria-hidden
                className="col-start-4 row-start-2 text-ui text-ink-muted sm:col-start-5 sm:row-start-1"
              >
                ×
              </span>
              <InlineInput
                name="line_unit_price"
                inputMode="decimal"
                required
                aria-label="Unit price"
                placeholder="0.00"
                className="tabular col-start-5 row-start-2 text-right sm:col-start-6 sm:row-start-1"
                value={line.unitPrice}
                onChange={(event) => setLine(index, { unitPrice: event.target.value })}
              />
              <Tooltip label="Remove line" align="end" className="col-start-5 row-start-1 justify-self-end sm:col-start-7">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="px-1.5"
                  disabled={lines.length === 1}
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  aria-label="Remove line"
                >
                  <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
                </Button>
              </Tooltip>
            </li>
          ))}
        </ul>
        <AddTrigger
          label="Add line"
          className="mt-1"
          onClick={() => setLines((current) => [...current, newLine()])}
        />
      </section>

      <Card padding="dense" className="space-y-1 text-ui">
        <SumRow label="Subtotal">
          <span className="tabular px-1 text-ink">{formatMoney(preview.subtotalCents)}</span>
        </SumRow>
        <SumRow label="Tax">
          <InlineInput
            name="tax"
            inputMode="decimal"
            aria-label="Tax"
            placeholder="0.00"
            className="tabular w-28 text-right"
            value={tax}
            onChange={(event) => setTax(event.target.value)}
          />
        </SumRow>
        <SumRow label="Shipping">
          <InlineInput
            name="shipping"
            inputMode="decimal"
            aria-label="Shipping"
            placeholder="0.00"
            className="tabular w-28 text-right"
            value={shipping}
            onChange={(event) => setShipping(event.target.value)}
          />
        </SumRow>
        <SumRow label="Discount">
          <InlineInput
            name="discount"
            inputMode="decimal"
            aria-label="Discount"
            placeholder="0.00"
            className="tabular w-28 text-right"
            value={discount}
            onChange={(event) => setDiscount(event.target.value)}
          />
        </SumRow>
        <SumRow label="Total" strong>
          <span className="tabular px-1 font-semibold text-ink">
            {formatMoney(preview.totalCents)}
          </span>
        </SumRow>
      </Card>

      <FieldError>{state.error}</FieldError>

      {/* Pinned above the dock while the form scrolls on a phone, so Save
       * order is in reach from the first screen (taste:forward-action-in-reach).
       * The inventory note rides with it, since it says what the press does,
       * and the pair sit on a panel of their own rather than on the page. */}
      <div className="sheet sticky bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom))] z-over-link -mx-4 flex items-center gap-3 border-t border-border bg-surface px-4 py-3 sm:static sm:mx-0 sm:rounded-card sm:border-0 sm:card-pad-dense">
        <Button type="submit" pending={pending} className="shrink-0">
          {pending ? 'Saving…' : 'Save order'}
        </Button>
        <p className="text-small text-ink-muted">
          Each unit lands in inventory with its share of tax, shipping and discount.
        </p>
      </div>
    </form>
  );
}

/** One line of the sum: its name on the left, its amount on the right. */
function SumRow({
  label,
  strong = false,
  children,
}: {
  label: string;
  strong?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={strong ? 'font-semibold text-ink' : 'text-ink-muted'}>{label}</span>
      {children}
    </div>
  );
}
