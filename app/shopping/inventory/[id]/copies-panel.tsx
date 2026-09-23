'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { RotateCcw, Tag } from 'lucide-react';
import { separateCopy, ungroupItems } from '@/app/shopping/inventory/group-actions';
import type { ActionState } from '@/app/shopping/inventory/actions';
import { Button } from '@/components/ui/button';
import { CardSection, foldCount } from '@/components/ui/card';
import { FieldError } from '@/components/ui/field';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/cn';

export type CopyRow = {
  id: string;
  acquiredAt: string | null;
  costCents: number;
  merchantName: string | null;
  orderId: string | null;
  forSale: boolean;
  returnPlanned: boolean;
};

/**
 * The individual copies behind one item, and the two buttons that decide what
 * counts as one item.
 *
 * The page above this is about the item — its name, its category, the fields
 * its category carries — because that is what those things describe. What
 * genuinely differs between one box and another is here: when it was bought,
 * what it cost, which order it came from, whether this particular one is on
 * the sell page.
 *
 * "Separate this copy" is the escape hatch for a stack that should not have
 * been one; "Ungroup" undoes a grouping made by hand and hands the copies back
 * to being stacked on their own details. Both are reversible, which is why
 * neither asks twice.
 */
export function CopiesPanel({
  copies,
  currentId,
  groupId,
  derived,
}: {
  copies: CopyRow[];
  /** The copy whose page this is, highlighted in the list. */
  currentId: string;
  /** Set when a person grouped these by hand — what "Ungroup" would undo. */
  groupId: string | null;
  /** True when these stacked on their own details rather than by instruction. */
  derived: boolean;
}) {
  const [separateState, separateAction, separatePending] = useActionState(
    separateCopy,
    {} as ActionState,
  );
  const [ungroupState, ungroupAction, ungroupPending] = useActionState(
    ungroupItems,
    {} as ActionState,
  );

  const total = copies.reduce((sum, copy) => sum + copy.costCents, 0);
  const pending = separatePending || ungroupPending;

  return (
    <CardSection
      fold={foldCount(copies.length, 'copy', 'copies')}
      title={
        <>
          Copies <span className="font-normal text-ink-muted">({copies.length})</span>
        </>
      }
      action={
        groupId ? (
          <form action={ungroupAction}>
            <input type="hidden" name="group_id" value={groupId} />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={pending}
              pending={ungroupPending}
            >
              {ungroupPending ? 'Ungrouping…' : 'Ungroup'}
            </Button>
          </form>
        ) : undefined
      }
    >
      <div className="space-y-3">
      <p className="text-ui text-ink-muted">
        {copies.length === 1
          ? 'One of these, bought once.'
          : derived
            ? 'Stacked because they look like the same thing. Everything above describes the item; what differs between copies is here.'
            : 'Grouped by you. Everything above describes the item; what differs between copies is here.'}
      </p>

      {/* Divides and space, no frame: the card around this already said these
          belong together. The one on this page keeps the accent tint, which
          is the only grouping claim in the list that means anything. Law 11. */}
      <ul className="divide-y divide-border">
        {copies.map((copy, index) => (
          <li
            key={copy.id}
            className={cn(
              'row-pad flex flex-wrap items-center gap-x-3 gap-y-1 text-ui',
              copy.id === currentId && '-mx-2 rounded-control bg-accent-tint px-2',
            )}
          >
            <span className="w-6 shrink-0 text-ink-muted">#{index + 1}</span>

            <span className="min-w-0 flex-1">
              <span className="text-ink">{copy.acquiredAt ?? 'Date unknown'}</span>
              {copy.merchantName && (
                <span className="text-ink-muted"> · {copy.merchantName}</span>
              )}
              {copy.forSale && (
                <span className="ml-2 inline-flex items-center gap-1 align-middle text-micro font-semibold uppercase tracking-wide text-caution">
                  <Tag className="size-3.5" strokeWidth={1.75} aria-hidden />
                  For sale
                </span>
              )}
              {copy.returnPlanned && (
                <span className="ml-2 inline-flex items-center gap-1 align-middle text-micro font-semibold uppercase tracking-wide text-accent">
                  <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden />
                  To return
                </span>
              )}
            </span>

            <span className="tabular shrink-0 font-medium text-ink">
              {formatMoney(copy.costCents)}
            </span>

            {copy.id === currentId ? (
              <span className="shrink-0 text-small text-ink-muted">This one</span>
            ) : (
              <Link
                href={`/shopping/inventory/${copy.id}`}
                className="shrink-0 text-ui font-medium text-accent hover:underline"
              >
                Open
              </Link>
            )}

            {copies.length > 1 && (
              <form action={separateAction} className="shrink-0">
                <input type="hidden" name="id" value={copy.id} />
                <Button type="submit" size="sm" variant="ghost" disabled={pending}>
                  Separate
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {copies.length > 1 && (
        <p className="tabular text-ui text-ink-muted">
          {formatMoney(total)} total across {copies.length} copies
        </p>
      )}

      {(separateState.message || ungroupState.message) && (
        <p className="text-ui text-positive">
          {separateState.message ?? ungroupState.message}
        </p>
      )}
      <FieldError>{separateState.error ?? ungroupState.error}</FieldError>
      </div>
    </CardSection>
  );
}
