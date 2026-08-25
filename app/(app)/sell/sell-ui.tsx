'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import {
  importBooksFromOrders,
  noteListingIntent,
  updateSellSettings,
  type SellActionState,
} from './actions';
import {
  confirmBookEdition,
  switchBookEdition,
  type BookActionState,
} from '@/app/(app)/inventory/add/actions';
import { disposeInventoryItem, type ActionState } from '@/app/(app)/inventory/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/field';
import { formatCentsAsDollarsInput, formatMoney } from '@/lib/money';
import type { SellBookRow, SellPendingRow } from '@/lib/sell/load';
import type { SellPath } from '@/lib/sell/route';

const PATH_LABEL: Record<SellPath, string> = {
  list_individually: 'List individually',
  lot: 'Lot together',
  buyback: 'Buyback vendor',
  donate: 'Donate',
};

function SellRowActions({ row }: { row: SellBookRow }) {
  const [disposeState, disposeAction, disposePending] = useActionState(
    disposeInventoryItem,
    {} as ActionState,
  );
  const [noteState, noteAction, notePending] = useActionState(
    noteListingIntent,
    {} as SellActionState,
  );

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {row.path === 'buyback' && row.buyback?.url && (
        <a
          href={row.buyback.url}
          target="_blank"
          rel="noreferrer"
          className="text-[13px] text-brand underline"
        >
          Open {row.buyback.vendor}
        </a>
      )}
      {(row.path === 'list_individually' || row.path === 'lot') && (
        <form action={noteAction}>
          <input type="hidden" name="id" value={row.inventoryItemId} />
          <input type="hidden" name="note" value={`Sell assistant: ${PATH_LABEL[row.path]}`} />
          <Button type="submit" size="sm" variant="secondary" disabled={notePending}>
            I’ll list this myself
          </Button>
        </form>
      )}
      {row.path === 'donate' && (
        <form action={disposeAction}>
          <input type="hidden" name="id" value={row.inventoryItemId} />
          <input type="hidden" name="disposal_method" value="donated" />
          <input type="hidden" name="disposal_proceeds" value="" />
          <Button type="submit" size="sm" variant="secondary" disabled={disposePending}>
            Mark donated
          </Button>
        </form>
      )}
      {row.path === 'buyback' && (
        <form action={disposeAction}>
          <input type="hidden" name="id" value={row.inventoryItemId} />
          <input type="hidden" name="disposal_method" value="sold" />
          <input
            type="hidden"
            name="disposal_proceeds"
            value={
              row.netBuybackCents != null
                ? formatCentsAsDollarsInput(row.netBuybackCents)
                : ''
            }
          />
          <Button type="submit" size="sm" disabled={disposePending}>
            Mark sold to buyback
          </Button>
        </form>
      )}
      <FieldError>{disposeState.error ?? noteState.error}</FieldError>
      {(disposeState.message || noteState.message) && (
        <p className="w-full text-[13px] text-brand">
          {disposeState.message ?? noteState.message}
        </p>
      )}
    </div>
  );
}

export function SellSettingsForm({
  netFloorCents,
  effortCents,
}: {
  netFloorCents: number;
  effortCents: number;
}) {
  const [state, action, pending] = useActionState(updateSellSettings, {} as SellActionState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-4">
      <div>
        <Label htmlFor="net_floor">Net floor ($)</Label>
        <Input
          id="net_floor"
          name="net_floor"
          defaultValue={formatCentsAsDollarsInput(netFloorCents)}
          className="w-28"
        />
      </div>
      <div>
        <Label htmlFor="effort">Effort cost ($)</Label>
        <Input
          id="effort"
          name="effort"
          defaultValue={formatCentsAsDollarsInput(effortCents)}
          className="w-28"
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Update'}
      </Button>
      <FieldError>{state.error}</FieldError>
      {state.message && <p className="text-[13px] text-brand">{state.message}</p>}
    </form>
  );
}

export function SellPathGroup({
  path,
  rows,
}: {
  path: SellPath;
  rows: SellBookRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-ink">
        {PATH_LABEL[path]}{' '}
        <span className="font-normal text-ink-muted">({rows.length})</span>
      </h2>
      <ul className="divide-y divide-border rounded-card border border-border bg-surface">
        {rows.map((row) => (
          <li key={row.inventoryItemId} className="flex gap-3 px-4 py-3">
            {row.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={row.imageUrl}
                alt=""
                className="h-16 w-12 shrink-0 rounded object-cover bg-canvas"
              />
            ) : (
              <div className="h-16 w-12 shrink-0 rounded bg-canvas" />
            )}
            <div className="min-w-0 flex-1">
              <Link
                href={`/inventory/${row.inventoryItemId}`}
                className="font-medium text-ink hover:underline"
              >
                {row.shortName || row.name}
              </Link>
              <p className="text-[13px] text-ink-muted">
                {row.authors.join(', ')}
                {row.isbn13 ? ` · ${row.isbn13}` : ''}
              </p>
              <p className="mt-1 text-[12px] text-ink-faint">{row.reason}</p>
              <p className="mt-1 text-[13px] text-ink-muted">
                {row.netSelfCents != null && (
                  <span className="mr-3">Self net {formatMoney(row.netSelfCents)}</span>
                )}
                {row.netBuybackCents != null && (
                  <span className="mr-3">Buyback net {formatMoney(row.netBuybackCents)}</span>
                )}
                {row.path === 'donate' && row.donateFmvCents > 0 && (
                  <span>FMV hint {formatMoney(row.donateFmvCents)} (not tax advice)</span>
                )}
              </p>
              <SellRowActions row={row} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}


function editionLine(row: {
  edition: string | null;
  publisher: string | null;
  publishedYear: number | null;
}): string {
  const parts = [row.edition, row.publisher, row.publishedYear].filter(Boolean).map(String);
  return parts.length > 0 ? parts.join(' · ') : 'Edition not stated by the catalog';
}

function PendingBookRow({ row }: { row: SellPendingRow }) {
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmBookEdition,
    {} as BookActionState,
  );
  const [switchState, switchAction, switchPending] = useActionState(
    switchBookEdition,
    {} as BookActionState,
  );

  return (
    <li className="flex gap-3 px-4 py-3">
      {row.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary catalog CDNs
        <img
          src={row.imageUrl}
          alt=""
          className="h-16 w-12 shrink-0 rounded object-cover bg-canvas"
        />
      ) : (
        <div className="h-16 w-12 shrink-0 rounded bg-canvas" />
      )}
      <div className="min-w-0 flex-1">
        <Link
          href={`/inventory/${row.inventoryItemId}`}
          className="font-medium text-ink hover:underline"
        >
          {row.title}
        </Link>
        {row.authors.length > 0 && (
          <p className="text-[13px] text-ink-muted">{row.authors.join(', ')}</p>
        )}
        <p className="text-[13px] text-ink-faint">
          {editionLine(row)}
          {row.isbn13 ? ` · ISBN ${row.isbn13}` : ' · no ISBN yet'}
        </p>
        <p className="mt-1 text-[12px] text-ink-muted">
          {row.confirmationReason ??
            'More than one printing matches this title, and buyback quotes are per ISBN.'}
          {row.autoImported ? ' Imported from an order email.' : ''}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <form action={confirmAction}>
            <input type="hidden" name="inventory_item_id" value={row.inventoryItemId} />
            <Button type="submit" size="sm" disabled={confirmPending}>
              {confirmPending ? 'Saving…' : 'This edition is right'}
            </Button>
          </form>
          {row.candidates.slice(0, 2).map((candidate, index) => (
            <form action={switchAction} key={candidate.isbn13 ?? `${candidate.title}-${index}`}>
              <input type="hidden" name="inventory_item_id" value={row.inventoryItemId} />
              <input type="hidden" name="candidate_json" value={JSON.stringify(candidate)} />
              <Button type="submit" size="sm" variant="secondary" disabled={switchPending}>
                {[candidate.publisher, candidate.publishedYear].filter(Boolean).join(' ') ||
                  candidate.title}
              </Button>
            </form>
          ))}
          {row.candidates.length > 2 && (
            <Link
              href={`/inventory/${row.inventoryItemId}`}
              className="text-[13px] text-brand hover:underline"
            >
              {row.candidates.length - 2} more printing(s)
            </Link>
          )}
        </div>
        <FieldError>{confirmState.error ?? switchState.error}</FieldError>
      </div>
    </li>
  );
}

export function SellConfirmQueue({ rows }: { rows: SellPendingRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">
          Confirm the edition{' '}
          <span className="font-normal text-ink-muted">({rows.length})</span>
        </h2>
        <p className="text-[13px] text-ink-muted">
          Price follows the printing, so these sit out of routing until you pick one.
        </p>
      </div>
      <ul className="divide-y divide-border rounded-card border border-border bg-surface">
        {rows.map((row) => (
          <PendingBookRow key={row.inventoryItemId} row={row} />
        ))}
      </ul>
    </section>
  );
}

/** Pull books out of orders that were imported before book detection existed. */
export function ImportBooksFromOrdersButton() {
  const [state, action, pending] = useActionState(
    importBooksFromOrders,
    {} as SellActionState,
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? 'Scanning orders…' : 'Scan past orders for books'}
      </Button>
      <FieldError>{state.error}</FieldError>
      {state.message && <p className="text-[13px] text-brand">{state.message}</p>}
    </form>
  );
}
