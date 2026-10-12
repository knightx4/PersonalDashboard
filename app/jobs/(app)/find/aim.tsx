'use client';

import Link from 'next/link';
import { useActionState, useRef, useState } from 'react';
import { CardSection } from '@/components/ui/card';
import { InlineInput } from '@/components/ui/field';
import { ValueList, ValueRow } from '@/components/ui/value-row';
import type { SetupGap } from '@/lib/jobs/suggest/gaps';
import { saveAim, type AimState } from './actions';

/**
 * What the search is aiming at: the titles you want and the industries Dash
 * never suggests from. They moved here from Settings (plan #1589) because
 * they shape the roles and people below them, and each is edited where it is
 * shown (law 12).
 */
export function SearchAim({
  targetTitles,
  excludedIndustries,
  gaps = [],
}: {
  targetTitles: string;
  excludedIndustries: string;
  /** What is missing from the setup and what it changes (gaps.ts). */
  gaps?: SetupGap[];
}) {
  return (
    <CardSection title="What you are aiming at">
      {gaps.length > 0 && (
        <ul className="mb-2 space-y-1" aria-label="What the searches are missing">
          {gaps.map((gap) => (
            <li key={gap.key} className="text-small text-caution">
              {gap.text}{' '}
              {gap.href && (
                <Link href={gap.href} className="press-area font-medium underline underline-offset-2">
                  Set it
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      <ValueList>
        <AimField
          field="targetTitles"
          label="Target titles"
          value={targetTitles}
          placeholder="Strategic Finance Analyst, FP&A Manager"
        />
        <AimField
          field="excludedIndustries"
          label="Never suggest"
          value={excludedIndustries}
          placeholder="Crypto, Healthcare, Defense"
        />
      </ValueList>
    </CardSection>
  );
}

/**
 * One list, read as wrapping text until it is pressed (law 14), then an inline
 * field saved on Enter or on leaving it; Escape puts it back.
 */
function AimField({
  field,
  label,
  value,
  placeholder,
}: {
  field: 'targetTitles' | 'excludedIndustries';
  label: string;
  value: string;
  placeholder: string;
}) {
  const [state, action] = useActionState<AimState, FormData>(saveAim, {});
  const [editing, setEditing] = useState(false);
  // What the row shows between pressing save and the page reading it back.
  const [shown, setShown] = useState(value);
  const formRef = useRef<HTMLFormElement>(null);

  if (!editing) {
    return (
      <ValueRow
        label={label}
        value={
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${label.toLowerCase()}`}
            className="press -mx-1 block w-full rounded-control px-1 text-left hover:bg-sunken"
          >
            {shown ? (
              <span className="text-ink">{shown}</span>
            ) : (
              <span className="text-ink-ghost">{placeholder}</span>
            )}
            {state.error && <span className="mt-1 block text-small text-danger">{state.error}</span>}
          </button>
        }
      />
    );
  }

  return (
    <ValueRow
      label={label}
      value={
        <form
          ref={formRef}
          action={(data) => {
            setShown(String(data.get('value') ?? '').trim());
            setEditing(false);
            return action(data);
          }}
          className="-mx-1"
        >
          <input type="hidden" name="field" value={field} />
          <InlineInput
            name="value"
            aria-label={label}
            autoFocus
            defaultValue={shown}
            placeholder={placeholder}
            onBlur={(event) => {
              if (event.currentTarget.value.trim() !== shown) formRef.current?.requestSubmit();
              else setEditing(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === 'Escape') {
                event.currentTarget.value = shown;
                event.currentTarget.blur();
              }
            }}
          />
          <p className="mt-1 px-1 text-small text-ink-muted">Separate entries with commas.</p>
        </form>
      }
    />
  );
}
