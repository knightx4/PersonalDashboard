'use client';

import { useActionState, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { createManualOrder, type ActionState } from '@/app/shopping/orders/actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FieldError, Input, Select } from '@/components/ui/field';
import type { Person } from '@/lib/people/load';
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
}: {
  merchants: MerchantOption[];
  categories: CategoryOption[];
  defaultDate: string;
  people?: Person[];
  defaultPersonId?: string | null;
}) {
  const [state, action, pending] = useActionState(createManualOrder, initialState);
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [tax, setTax] = useState('');
  const [shipping, setShipping] = useState('');
  const [discount, setDiscount] = useState('');

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

  return (
    <form action={action} className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2">
        <Field id="merchant" label="Merchant" className="sm:col-span-2">
          <MerchantField id="merchant" merchants={merchants} />
        </Field>

        <Field id="external_order_number" label="Order number">
          <Input
            id="external_order_number"
            name="external_order_number"
            placeholder="Optional"
          />
        </Field>

        <Field id="order_date" label="Order date">
          <Input
            id="order_date"
            name="order_date"
            type="date"
            required
            defaultValue={defaultDate}
          />
        </Field>

        {/*
          Only shown once there is somebody to choose between. On a
          single-person account this is a field with one answer, and asking it
          every time would be noise.
        */}
        {people.length > 1 && (
          <Field id="person_id" label="Whose is it">
            <Select id="person_id" name="person_id" defaultValue={defaultPersonId ?? ''}>
              <option value="">Nobody in particular</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-ui font-semibold text-ink">Line items</h2>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setLines((current) => [...current, newLine()])}
          >
            <Plus className="size-4" strokeWidth={1.75} aria-hidden />
            Add line
          </Button>
        </div>

        <div className="space-y-3">
          {/* ui-ok: card-per-row -- law 13 is about lists you read, and these
            * are not rows of anything: each is a twelve-column editor for one
            * order line on a create form. The card is what keeps two half-typed
            * lines from running into each other. */}
          {lines.map((line, index) => (
            <Card key={line.key} padding="dense" className="grid gap-3 sm:grid-cols-12">
              <Field id={`line_name_${line.key}`} label="Item" className="sm:col-span-4">
                <Input
                  id={`line_name_${line.key}`}
                  name="line_name"
                  required
                  value={line.name}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, name: event.target.value } : row,
                      ),
                    )
                  }
                  placeholder="What did you buy?"
                />
              </Field>
              <Field id={`line_variant_${line.key}`} label="Variant" className="sm:col-span-2">
                <Input
                  id={`line_variant_${line.key}`}
                  name="line_variant"
                  value={line.variant}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, variant: event.target.value } : row,
                      ),
                    )
                  }
                  placeholder="Size, color…"
                />
              </Field>
              <Field id={`line_category_${line.key}`} label="Category" className="sm:col-span-2">
                <Select
                  id={`line_category_${line.key}`}
                  name="line_category_id"
                  value={line.categoryId}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, categoryId: event.target.value } : row,
                      ),
                    )
                  }
                >
                  <option value="">Uncategorized</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`line_qty_${line.key}`} label="Qty" className="sm:col-span-1">
                <Input
                  id={`line_qty_${line.key}`}
                  name="line_quantity"
                  inputMode="numeric"
                  required
                  value={line.quantity}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, quantity: event.target.value } : row,
                      ),
                    )
                  }
                />
              </Field>
              <Field id={`line_price_${line.key}`} label="Unit price" className="sm:col-span-2">
                <Input
                  id={`line_price_${line.key}`}
                  name="line_unit_price"
                  inputMode="decimal"
                  required
                  placeholder="0.00"
                  value={line.unitPrice}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, unitPrice: event.target.value } : row,
                      ),
                    )
                  }
                />
              </Field>
              <div className="flex items-end sm:col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  disabled={lines.length === 1}
                  onClick={() =>
                    setLines((current) => current.filter((_, i) => i !== index))
                  }
                  aria-label="Remove line"
                >
                  <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Field id="tax" label="Tax">
          <Input
            id="tax"
            name="tax"
            inputMode="decimal"
            placeholder="0.00"
            value={tax}
            onChange={(event) => setTax(event.target.value)}
          />
        </Field>
        <Field id="shipping" label="Shipping">
          <Input
            id="shipping"
            name="shipping"
            inputMode="decimal"
            placeholder="0.00"
            value={shipping}
            onChange={(event) => setShipping(event.target.value)}
          />
        </Field>
        <Field id="discount" label="Discount">
          <Input
            id="discount"
            name="discount"
            inputMode="decimal"
            placeholder="0.00"
            value={discount}
            onChange={(event) => setDiscount(event.target.value)}
          />
        </Field>
      </section>

      <Card padding="dense" className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1 text-body text-ink-muted">
          <p>
            Subtotal{' '}
            <span className="tabular text-ink">{formatMoney(preview.subtotalCents)}</span>
          </p>
          <p>
            Total{' '}
            <span className="tabular font-semibold text-ink">
              {formatMoney(preview.totalCents)}
            </span>
          </p>
          <p className="text-small text-ink-muted">
            Each physical unit lands in inventory with a proportional share of tax,
            shipping and discount.
          </p>
        </div>
        <Button type="submit" pending={pending}>
          {pending ? 'Saving…' : 'Save order'}
        </Button>
      </Card>

      <FieldError>{state.error}</FieldError>
    </form>
  );
}
