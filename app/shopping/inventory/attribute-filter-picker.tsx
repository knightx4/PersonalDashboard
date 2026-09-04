'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { AttributeFacet } from '@/lib/inventory/attribute-filters';

/**
 * "Add filter" for the details items carry — a book's genre, a shirt's brand.
 *
 * Which fields exist depends on the user's templates, so the choices are built
 * from the items on screen rather than hardcoded. Picking a field then a value
 * produces an ordinary link, so the filtered view is shareable and the back
 * button undoes it.
 */
export function AttributeFilterPicker({
  facets,
  hrefFor,
}: {
  facets: AttributeFacet[];
  /** Where adding `key:value` points. Built on the server with every other filter kept. */
  hrefFor: Record<string, Record<string, string>>;
}) {
  const [open, setOpen] = useState(false);
  const [fieldKey, setFieldKey] = useState('');

  const facet = useMemo(
    () => facets.find((entry) => entry.key === fieldKey) ?? null,
    [facets, fieldKey],
  );

  if (facets.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="press flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-ui text-ink-muted hover:bg-surface hover:text-ink"
      >
        <Plus className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        Add filter
      </button>

      {open && (
        <div className="mt-1 space-y-1 rounded-lg border border-border bg-surface p-2">
          <label className="block text-micro font-medium text-ink-muted" htmlFor="attr-field">
            Property
          </label>
          <select
            id="attr-field"
            value={fieldKey}
            onChange={(event) => setFieldKey(event.target.value)}
            className="h-8 w-full rounded-md border border-border bg-canvas px-2 text-ui text-ink focus:border-accent focus:outline-none"
          >
            <option value="">Choose a property…</option>
            {facets.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>

          {facet && (
            <div className="max-h-56 space-y-0.5 overflow-y-auto overscroll-contain pt-1">
              {facet.values.map((value) => {
                const href = hrefFor[facet.key]?.[value];
                if (!href) return null;
                return (
                  <Link
                    key={value}
                    href={href}
                    className="block truncate rounded-md px-2 py-1 text-ui text-ink-muted hover:bg-canvas hover:text-ink"
                  >
                    {value}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
