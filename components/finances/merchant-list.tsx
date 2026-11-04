'use client';

import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Meter } from '@/components/ui/meter';
import { Popover } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import { usePopover } from '@/lib/use-popover';
import type { MerchantSlice } from '@/lib/finances/spending/model';
import { ChargeRow } from './charge-row';

/**
 * Spending by merchant (plan #2593.7), biggest first, each with a bar of how
 * much of the biggest it is. Pressing a merchant opens its charges in a
 * popover: the dates, the accounts, refunds as money back, and the order a
 * charge paid for.
 */
export function MerchantList({
  merchants,
  currency = 'USD',
  openKey,
}: {
  merchants: readonly MerchantSlice[];
  currency?: string;
  /** A merchant to draw with its charges open. For the gallery. */
  openKey?: string;
}) {
  const max = merchants[0]?.cents ?? 0;
  return (
    <ul className="divide-y divide-border">
      {merchants.map((m) => (
        <MerchantRow key={m.key} merchant={m} max={max} currency={currency} startOpen={m.key === openKey} />
      ))}
    </ul>
  );
}

function MerchantRow({
  merchant,
  max,
  currency,
  startOpen,
}: {
  merchant: MerchantSlice;
  max: number;
  currency: string;
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  usePopover({ open, onClose: () => setOpen(false), panelRef, triggerRef });
  const amount = formatMoney(merchant.cents, currency);
  const charges = merchant.charges.length;

  return (
    <li className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className="block w-full rounded-control px-4 py-3 text-left hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="mb-1.5 flex items-baseline gap-3">
          <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">{merchant.name}</span>
          <span className="shrink-0 text-ui text-ink-muted">
            {charges} {charges === 1 ? 'charge' : 'charges'}
          </span>
          <span className="tabular shrink-0 text-body text-ink">{amount}</span>
          <ChevronDown
            aria-hidden
            strokeWidth={1.75}
            className={cn('size-4 shrink-0 self-center text-ink-muted transition-transform', open && 'rotate-180')}
          />
        </span>
        <Meter
          value={merchant.cents}
          max={max}
          label={`${merchant.name}: ${amount} of ${formatMoney(max, currency)}, the most spent at one merchant`}
        />
      </button>
      {open && (
        <Popover
          ref={panelRef}
          role="dialog"
          aria-label={`Charges at ${merchant.name}`}
          anchor="trigger-below-end"
          className="w-[min(24rem,calc(100vw-2rem))] max-h-96 overflow-y-auto"
        >
          <p className="border-b border-border px-4 pb-2 pt-3 text-ui font-semibold text-ink">
            {merchant.name}, {amount}
          </p>
          <ul className="divide-y divide-border">
            {merchant.charges.map((charge) => (
              <ChargeRow key={charge.id} charge={charge} currency={currency} showName={false} />
            ))}
          </ul>
        </Popover>
      )}
    </li>
  );
}
