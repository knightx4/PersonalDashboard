'use client';

import { useActionState, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { createManualOrder, type ActionState } from '@/app/shopping/orders/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label, Select } from '@/components/ui/field';
import {
  computeOrderTotalCents,
  formatMoney,
  orderSubtotalCents,
  parseDollarsToCents,
} from '@/lib/money';

interface MerchantOption {
  id: string;
  name: string;
}

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
}: {
  merchants: MerchantOption[];
  categories: CategoryOption[];
  defaultDate: string;
}) {
  const [state, action, pending] = useActionState(createManualOrder, initialState);
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [tax, setTax] = useState('');
  const [shipping, setShipping] = useState('');
  const [discount, setDiscount] = useState('');
  const [merchantMode, setMerchantMode] = useState<'pick' | 'custom'>('pick');

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
        <div className="sm:col-span-2">
          <Label htmlFor="merchant_id">Merchant</Label>
          {merchantMode === 'pick' ? (
            <Select
              id="merchant_id"
              name="merchant_id"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value === '__custom__') {
                  setMerchantMode('custom');
                  event.target.value = '';
                }
              }}
            >
              <option value="">Select a merchant</option>
              {merchants.map((merchant) => (
                <option key={merchant.id} value={merchant.id}>
                  {merchant.name}
                </option>
              ))}
              <option value="__custom__">Other (type a name)…</option>
            </Select>
          ) : (
            <div className="flex gap-2">
              <Input
                name="custom_merchant_name"
                placeholder="Merchant name"
                autoFocus
                required
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => setMerchantMode('pick')}
              >
                Back
              </Button>
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="external_order_number">Order number</Label>
          <Input
            id="external_order_number"
            name="external_order_number"
            placeholder="Optional"
          />
        </div>

        <div>
          <Label htmlFor="order_date">Order date</Label>
          <Input
            id="order_date"
            name="order_date"
            type="date"
            required
            defaultValue={defaultDate}
          />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Line items</h2>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setLines((current) => [...current, newLine()])}
          >
            <Plus className="size-4" strokeWidth={1.75} />
            Add line
          </Button>
        </div>

        <div className="space-y-3">
          {lines.map((line, index) => (
            <div
              key={line.key}
              className="grid gap-3 rounded-card border border-border bg-surface p-3 sm:grid-cols-12"
            >
              <div className="sm:col-span-4">
                <Label htmlFor={`line_name_${line.key}`}>Item</Label>
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
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor={`line_variant_${line.key}`}>Variant</Label>
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
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor={`line_category_${line.key}`}>Category</Label>
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
              </div>
              <div className="sm:col-span-1">
                <Label htmlFor={`line_qty_${line.key}`}>Qty</Label>
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
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor={`line_price_${line.key}`}>Unit price</Label>
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
              </div>
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
                  <Trash2 className="size-4" strokeWidth={1.75} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="tax">Tax</Label>
          <Input
            id="tax"
            name="tax"
            inputMode="decimal"
            placeholder="0.00"
            value={tax}
            onChange={(event) => setTax(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="shipping">Shipping</Label>
          <Input
            id="shipping"
            name="shipping"
            inputMode="decimal"
            placeholder="0.00"
            value={shipping}
            onChange={(event) => setShipping(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="discount">Discount</Label>
          <Input
            id="discount"
            name="discount"
            inputMode="decimal"
            placeholder="0.00"
            value={discount}
            onChange={(event) => setDiscount(event.target.value)}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-end justify-between gap-4 rounded-card border border-border bg-surface px-4 py-3">
        <div className="space-y-1 text-sm text-ink-muted">
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
          <p className="text-[12px] text-ink-faint">
            Each physical unit lands in inventory with a proportional share of tax,
            shipping and discount.
          </p>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save order'}
        </Button>
      </div>

      <FieldError>{state.error}</FieldError>
    </form>
  );
}
