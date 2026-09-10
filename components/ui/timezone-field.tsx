'use client';

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/field';

/**
 * Type-and-pick timezone field.
 *
 * A plain text input is what let "ET" into the database and took every page
 * that formats a date down with a 500. A native `<datalist>` is the cheap fix
 * and is not enough: browsers disagree about whether it opens on focus, Safari
 * barely shows it, and none of them let you browse the list without typing
 * something first. So this is a real combobox — the list opens on focus,
 * filters as you type, and is navigable from the keyboard.
 *
 * It stays a text input underneath rather than a `<select>`, deliberately: the
 * server action still translates "ET" and friends, so pasting or typing an
 * abbreviation keeps working for anyone who does it out of habit.
 */

/** The detected zone never changes while the page is open. */
function subscribeNever(): () => void {
  return () => {};
}

/** Zones this browser knows. Empty on anything too old to say. */
function allZones(): string[] {
  try {
    const supported = (
      Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf;
    return supported ? supported('timeZone') : [];
  } catch {
    return [];
  }
}

/** What this computer is set to. */
export function detectTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** "GMT-4", for the hint beside each option. */
function offsetLabel(zone: string, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'shortOffset',
    }).formatToParts(now);
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/**
 * Cities that were renamed, and the zone id that did not follow.
 *
 * `Intl.supportedValuesOf` returns the canonical list, and canonical still
 * means the pre-rename spelling on most engines: Chromium reports
 * `Asia/Calcutta`, `Europe/Kiev` and `Asia/Saigon`. Typing "Kolkata" or "Kyiv"
 * — which is what a person types — matched nothing at all, so the zone was
 * simply unreachable through the field for anyone who lives there.
 *
 * Listed in both directions, because a newer engine returns the modern name
 * and somebody who learned the old one should still find it.
 */
const RENAMED: ReadonlyArray<readonly [string, string]> = [
  ['Asia/Calcutta', 'Asia/Kolkata'],
  ['Asia/Saigon', 'Asia/Ho_Chi_Minh'],
  ['Europe/Kiev', 'Europe/Kyiv'],
  ['Asia/Rangoon', 'Asia/Yangon'],
  ['Asia/Katmandu', 'Asia/Kathmandu'],
  ['Asia/Dacca', 'Asia/Dhaka'],
  ['Asia/Thimbu', 'Asia/Thimphu'],
  ['Asia/Ulan_Bator', 'Asia/Ulaanbaatar'],
  ['Asia/Macao', 'Asia/Macau'],
  ['America/Godthab', 'America/Nuuk'],
  ['Africa/Asmera', 'Africa/Asmara'],
  ['Atlantic/Faeroe', 'Atlantic/Faroe'],
  ['Pacific/Ponape', 'Pacific/Pohnpei'],
  ['Pacific/Truk', 'Pacific/Chuuk'],
  ['Pacific/Enderbury', 'Pacific/Kanton'],
];

const ALSO_KNOWN_AS = new Map<string, string>(
  RENAMED.flatMap(([a, b]) => [
    [a, b] as [string, string],
    [b, a] as [string, string],
  ]),
);

/** "america/new_york" and "america new york" both match "New York". */
function searchable(zone: string): string {
  const other = ALSO_KNOWN_AS.get(zone);
  return `${zone}${other ? ` ${other}` : ''}`.toLowerCase().replace(/[_/]/g, ' ');
}

/** Enough results to browse, few enough to render and read. */
const MAX_RESULTS = 60;

export function TimezoneField({
  id,
  name = 'timezone',
  defaultValue = '',
  placeholder = 'Europe/London',
}: {
  id?: string;
  name?: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  const reactId = useId();
  const inputId = id ?? `timezone-${reactId}`;
  const listId = `${inputId}-list`;

  // Null on the server and on the first render, then this computer's zone.
  //
  // Through useSyncExternalStore rather than an effect, for two reasons that
  // point the same way: the server has no idea what this computer is set to, so
  // rendering a guess would mismatch on hydration, and detecting in an effect
  // would mean setting state from one, which React rightly complains about.
  const detected = useSyncExternalStore(subscribeNever, detectTimeZone, () => null);

  // `null` means "the user has not chosen", which is what lets the detected
  // zone show through without ever overwriting a stored one.
  const [chosen, setChosen] = useState<string | null>(defaultValue || null);
  const value = chosen ?? detected ?? '';

  /**
   * What the user is typing, as distinct from what the field holds.
   *
   * These have to be separate. Filtering on the field's own value means that
   * the moment it holds anything — which, thanks to detection, is immediately —
   * opening the list shows exactly one option: the value already selected. The
   * list becomes unbrowsable at the precise moment it should be most useful.
   * `null` means "not typing", and that is what shows the full list.
   */
  const [query, setQuery] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const zones = useMemo(() => allZones(), []);

  const matches = useMemo(() => {
    const now = new Date();
    const needle = query === null ? '' : searchable(query.trim());
    const pool = zones.length ? zones : detected ? [detected] : [];

    const filtered = needle
      ? pool.filter((zone) => searchable(zone).includes(needle))
      : // Not typing: the whole list, with this computer's zone and the current
        // selection lifted to the top, since scrolling to them is the friction.
        [
          ...(detected && pool.includes(detected) ? [detected] : []),
          ...(value && pool.includes(value) ? [value] : []),
          ...pool,
        ];

    const seen = new Set<string>();
    return filtered
      .filter((zone) => !seen.has(zone) && seen.add(zone))
      .slice(0, MAX_RESULTS)
      .map((zone) => ({ zone, offset: offsetLabel(zone, now) }));
  }, [query, value, zones, detected]);

  // Close when the click lands outside.
  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setQuery(null);
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (zone: string) => {
    setChosen(zone);
    setQuery(null);
    setOpen(false);
    setActive(0);
  };

  /** Closing without choosing discards the half-typed query, not the value. */
  const close = () => {
    setQuery(null);
    setOpen(false);
    setActive(0);
  };

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((current) => {
        const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
        if (next < 0) return matches.length - 1;
        if (next >= matches.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === 'Enter' && open && matches[active]) {
      // Only swallow Enter when a suggestion is actually highlighted, so the
      // key still submits the form the rest of the time.
      event.preventDefault();
      choose(matches[active].zone);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') close();
  }

  return (
    <div ref={wrapRef} className="relative">
      <Input
        id={inputId}
        name={name}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        onChange={(event) => {
          // Typing sets both: the query drives the list, and the value is what
          // the form submits if they type a zone rather than picking one.
          setQuery(event.target.value);
          setChosen(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Focus alone is not enough: after picking a value the input is still
        // focused, so clicking it again fires no focus event and the list would
        // never reopen. Clicking a dropdown should always show the dropdown.
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="pr-9"
      />

      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? 'Hide timezones' : 'Show timezones'}
        onMouseDown={(event) => {
          // mousedown so the input keeps focus, and a toggle rather than an
          // open so a second click on the chevron closes it again.
          event.preventDefault();
          if (open) close();
          else setOpen(true);
        }}
        className="absolute right-0 top-0 flex h-10 w-9 items-center justify-center text-ink-muted hover:text-ink"
      >
        <ChevronDown
          className={cn('size-4 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open && matches.length > 0 && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Timezones"
          className="absolute z-overlay mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-raised py-1 shadow-lg"
        >
          {matches.map((match, index) => (
            <li
              key={match.zone}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              data-active={index === active}
              // mousedown, not click: blur would close the list first.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(match.zone);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-ui',
                index === active ? 'bg-accent-tint text-accent' : 'text-ink',
              )}
            >
              <span className="truncate">
                {match.zone.replace(/_/g, ' ')}
                {match.zone === detected && (
                  <span className="ml-2 text-small text-ink-muted">this computer</span>
                )}
              </span>
              <span className="shrink-0 text-small text-ink-muted">{match.offset}</span>
            </li>
          ))}
        </ul>
      )}

      {/*
        Offered rather than applied. A stored zone is a decision, and quietly
        replacing it because the laptop moved is how somebody ends up reading
        interview times in an airport's timezone.
      */}
      {detected && value !== detected && (
        <button
          type="button"
          onClick={() => choose(detected)}
          className="mt-1 text-micro text-accent hover:underline"
        >
          Use {detected.replace(/_/g, ' ')} — detected from this computer
        </button>
      )}
    </div>
  );
}
