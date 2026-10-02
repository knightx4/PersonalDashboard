'use client';

import { useActionState, useMemo, useState } from 'react';
import { CalendarDays, Hash, Trash2, User } from 'lucide-react';
import { createManualOrder, type ActionState } from '@/app/shopping/orders/actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AddTrigger } from '@/components/ui/add-trigger';
import { ChipInput, ChipSelect, FieldError, InlineInput } from '@/components/ui/field';
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
      {sourceMessageId && (
        <input type="hidden" name="source_message_id" value={sourceMessageId} />
      )}
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
        {/* The column names, once, where there is room for columns. */}
        <div
          aria-hidden
          className="mt-2 hidden gap-2 px-1 text-small text-ink-muted sm:grid sm:grid-cols-12"
        >
          <span className="sm:col-span-4">Item</span>
          <span className="sm:col-span-2">Variant</span>
          <span className="sm:col-span-2">Category</span>
          <span className="sm:col-span-1">Qty</span>
          <span className="sm:col-span-2">Unit price</span>
        </div>
        <ul className="mt-1 divide-y divide-border border-y border-border">
          {lines.map((line, index) => (
            <li key={line.key} className="row-pad grid grid-cols-6 items-center gap-1 sm:grid-cols-12 sm:gap-2">
              <InlineInput
                name="line_name"
                required
                aria-label="Item"
                placeholder="What did you buy?"
                className="col-span-6 sm:col-span-4"
                value={line.name}
                onChange={(event) => setLine(index, { name: event.target.value })}
              />
              <InlineInput
                name="line_variant"
                aria-label="Variant"
                placeholder="Size, colour…"
                className="col-span-3 sm:col-span-2"
                value={line.variant}
                onChange={(event) => setLine(index, { variant: event.target.value })}
              />
              <ChipSelect
                name="line_category_id"
                aria-label="Category"
                placeholderValue=""
                className="col-span-3 sm:col-span-2"
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
                className="tabular col-span-1 sm:col-span-1"
                value={line.quantity}
                onChange={(event) => setLine(index, { quantity: event.target.value })}
              />
              <InlineInput
                name="line_unit_price"
                inputMode="decimal"
                required
                aria-label="Unit price"
                placeholder="0.00"
                className="tabular col-span-4 sm:col-span-2"
                value={line.unitPrice}
                onChange={(event) => setLine(index, { unitPrice: event.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="col-span-1 justify-self-end"
                disabled={lines.length === 1}
                onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                aria-label="Remove line"
              >
                <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
              </Button>
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
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
          <p className="text-small text-ink-muted">
            Each physical unit lands in inventory with a proportional share of tax,
            shipping and discount.
          </p>
          <Button type="submit" pending={pending}>
            {pending ? 'Saving…' : 'Save order'}
          </Button>
        </div>
      </Card>

      <FieldError>{state.error}</FieldError>
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
