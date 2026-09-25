'use client';

import { useActionState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldError, Select } from '@/components/ui/field';
import { catalogLabel, subtreeOf } from '@/lib/plan/catalog';
import { PLAN_STATUS_LABEL, isClosed } from '@/lib/plan/load';
import { cn } from '@/lib/cn';
import type { TreeActionState, TreeActions, TreeCatalogEntry, TreeDependencyNode } from './types';

/**
 * What a step waits on, what waits on it, and the picker that adds an edge.
 *
 * An edge through a step above this one is drawn but cannot be removed here,
 * since it belongs to that step. The picker leaves out this step, everything
 * beneath it, what it already waits on and anything closed.
 */
export function Dependencies<E extends TreeCatalogEntry>({
  node,
  catalog,
  groupOf,
  actions,
}: {
  node: TreeDependencyNode;
  catalog: readonly E[];
  /** The heading a candidate is listed under in the picker. */
  groupOf: (entry: E) => string;
  actions: Pick<TreeActions, 'addDependency' | 'removeDependency'>;
}) {
  const [addState, addAction, addPending] = useActionState(
    actions.addDependency,
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
                #{link.item.number} {link.item.title}
                {isClosed(link.item.status) &&
                  ` (${PLAN_STATUS_LABEL[link.item.status].toLowerCase()})`}
                <button
                  type="submit"
                  disabled={removePending}
                  aria-label={`Stop waiting on #${link.item.number}`}
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
              #{ref.number} {ref.title} · above
            </span>
          ))}
        </div>
      )}

      {node.blocks.length > 0 && (
        <p className="text-small text-ink-muted">
          Unblocks {node.blocks.map((ref) => `#${ref.number} ${ref.title}`).join(', ')}
        </p>
      )}

      {candidates.length > 0 && (
        <form action={addAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="item" value={node.id} />
          {/* Width only. This carried `h-8 py-0 text-small`, which overrode
              three things the primitive is for: the dial's height, so it was
              32px on a phone where every control beside it is 36; and
              `text-base sm:text-ui`, which is the 16px that stops iOS zooming
              the whole page when the select is tapped. Twelve-pixel type on a
              native picker bought nothing and cost that. */}
          <Select
            name="depends_on"
            defaultValue=""
            className="w-auto max-w-xs"
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
          <Button type="submit" variant="ghost" pending={addPending}>
            {addPending ? 'Adding…' : 'Add'}
          </Button>
          <FieldError>{addState.error ?? removeState.error}</FieldError>
        </form>
      )}
    </div>
  );
}
