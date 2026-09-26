'use client';

import { useActionState, useState } from 'react';
import { X } from 'lucide-react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { FieldError, Select } from '@/components/ui/field';
import { catalogLabel, subtreeOf } from '@/lib/plan/catalog';
import { PLAN_STATUS_LABEL, isClosed } from '@/lib/plan/load';
import { cn } from '@/lib/cn';
import type { TreeActionState, TreeActions, TreeCatalogEntry, TreeDependencyNode } from './types';

/**
 * How a chip points at a step: its outline ("12.1") as the rows read, or its
 * number where it has no outline. A goal step can wait on a step under
 * another goal, which has no number on this page and comes through as 0, so
 * that one has no handle and is named by its title alone (plan #983).
 */
function stepHandle(ref: { number: number; outline?: string }): string | null {
  if (ref.outline) return `#${ref.outline}`;
  return ref.number > 0 ? `#${ref.number}` : null;
}

/** A step as it is named in a chip: its handle and title. */
function stepName(ref: { number: number; outline?: string; title: string }): string {
  const handle = stepHandle(ref);
  return handle ? `${handle} ${ref.title}` : ref.title;
}

/**
 * What a step waits on, what waits on it, and the picker that adds an edge.
 *
 * An edge through a step above this one is drawn but cannot be removed here,
 * since it belongs to that step. The picker leaves out this step, everything
 * beneath it, what it already waits on and anything closed.
 *
 * The picker sits behind a "Wait on a step" line, as asking a question does,
 * and a closed step does not offer it at all: nothing waits once it is done
 * or dropped (plan #1041).
 */
export function Dependencies<E extends TreeCatalogEntry>({
  node,
  catalog,
  groupOf,
  actions,
  closed = false,
}: {
  node: TreeDependencyNode;
  catalog: readonly E[];
  /** The heading a candidate is listed under in the picker. */
  groupOf: (entry: E) => string;
  actions: Pick<TreeActions, 'addDependency' | 'removeDependency'>;
  /** Whether the step is done or dropped, which takes away the picker. */
  closed?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [addState, addAction, addPending] = useActionState(
    async (prev: TreeActionState, form: FormData) => {
      const next = await actions.addDependency(prev, form);
      if (!next.error) setPicking(false);
      return next;
    },
    {} as TreeActionState,
  );
  const [removeState, removeAction, removePending] = useActionState(
    actions.removeDependency,
    {} as TreeActionState,
  );

  const own = new Set(node.dependsOn.map((link) => link.item.id));
  const inherited = node.waitingOn.filter((ref) => !own.has(ref.id));
  const excluded = subtreeOf(catalog, node.id);
  const candidates = catalog.filter(
    (entry) => !excluded.has(entry.id) && !own.has(entry.id) && !entry.closed,
  );
  const byModule = new Map<string, E[]>();
  for (const entry of candidates) {
    const key = groupOf(entry);
    byModule.set(key, [...(byModule.get(key) ?? []), entry]);
  }

  const offer = !closed && candidates.length > 0;
  if (node.dependsOn.length === 0 && inherited.length === 0 && node.blocks.length === 0 && !offer)
    return null;

  return (
    <div className="space-y-2">
      {(node.dependsOn.length > 0 || inherited.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-small text-ink-muted">Waits on</span>
          {node.dependsOn.map((link) => (
            <form key={link.dependencyId} action={removeAction} className="contents">
              <input type="hidden" name="id" value={link.dependencyId} />
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-small',
                  isClosed(link.item.status)
                    ? 'bg-positive-tint text-positive'
                    : 'bg-caution-tint text-caution',
                )}
              >
                {stepName(link.item)}
                {isClosed(link.item.status) &&
                  ` (${PLAN_STATUS_LABEL[link.item.status].toLowerCase()})`}
                <button
                  type="submit"
                  disabled={removePending}
                  aria-label={`Stop waiting on ${stepHandle(link.item) ?? link.item.title}`}
                  className="press rounded-full p-0.5 hover:bg-surface/60"
                >
                  <X className="size-3" strokeWidth={2} aria-hidden />
                </button>
              </span>
            </form>
          ))}
          {inherited.map((ref) => (
            <span
              key={ref.id}
              title="Through a step above this one"
              className="inline-flex items-center rounded-full bg-caution-tint px-2 py-0.5 text-small text-caution opacity-80"
            >
              {stepName(ref)} · above
            </span>
          ))}
        </div>
      )}

      {node.blocks.length > 0 && (
        <p className="text-small text-ink-muted">
          Unblocks {node.blocks.map(stepName).join(', ')}
        </p>
      )}

      {offer && picking ? (
        <form
          action={addAction}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setPicking(false);
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="item" value={node.id} />
          {/* Width only. This carried `h-8 py-0 text-small`, which overrode
              three things the primitive is for: the dial's height, so it was
              32px on a phone where every control beside it is 36; and
              `text-base sm:text-ui`, which is the 16px that stops iOS zooming
              the whole page when the select is tapped. Twelve-pixel type on a
              native picker bought nothing and cost that. `max-w-full` keeps
              a long step title inside the panel on a phone, where it pushed
              the chevron out of sight. */}
          <Select
            name="depends_on"
            defaultValue=""
            required
            autoFocus
            className="w-auto min-w-0 max-w-full sm:max-w-xs"
            aria-label="A step this one has to wait for"
          >
            <option value="">Wait on a step…</option>
            {[...byModule.entries()].map(([label, entries]) => (
              <optgroup key={label} label={label}>
                {entries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {catalogLabel(entry)}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          <span className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPicking(false)}
              disabled={addPending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="ghost" pending={addPending}>
              {addPending ? 'Adding…' : 'Add'}
            </Button>
          </span>
          <FieldError>{addState.error ?? removeState.error}</FieldError>
        </form>
      ) : (
        <>
          {offer && <AddTrigger label="Wait on a step" onClick={() => setPicking(true)} />}
          <FieldError>{removeState.error}</FieldError>
        </>
      )}
    </div>
  );
}
