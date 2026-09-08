'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Select } from '@/components/ui/field';
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

      {/* No frame and no ground, the same as RailPicker's opened list: this
          drops into the rail rather than floating over anything, so a box
          four pixels under the trigger would be a second hairline arguing
          about a grouping the rail already made. Law 11.

          The select is the shared control rather than a hand-rolled 32px box:
          the height follows the density dial, the focus ring matches every
          other field, and it is 16px on a phone -- which matters here because
          the rail doubles as the mobile filter sheet, and a 13px control is
          what makes Safari zoom the page when it is tapped. Its own caption
          is gone: the first option says what it wants. Law 9. */}
      {open && (
        <div className="mt-1.5 space-y-1">
          <Select
            id="attr-field"
            aria-label="Property"
            value={fieldKey}
            onChange={(event) => setFieldKey(event.target.value)}
          >
            <option value="">Choose a property…</option>
            {facets.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </Select>

          {facet && (
            <div className="max-h-56 space-y-0.5 overflow-y-auto overscroll-contain pt-0.5">
              {facet.values.map((value) => {
                const href = hrefFor[facet.key]?.[value];
                if (!href) return null;
                return (
                  <Link
                    key={value}
                    href={href}
                    // A rail row, set exactly like the ones in every other
                    // RailGroup — these are the same thing, revealed later.
                    className="block truncate rounded-lg px-2.5 py-1.5 text-ui text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
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
