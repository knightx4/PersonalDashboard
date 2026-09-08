'use client';

import {
  useActionState,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { Plus, Search, X } from 'lucide-react';
import {
  createMerchantReturnPolicy,
  saveMerchantReturnPolicy,
  type ActionState,
} from '@/app/shopping/returns/actions';
import { Button } from '@/components/ui/button';
import { FieldError, InlineInput, Input, Label } from '@/components/ui/field';
import { Group } from '@/components/ui/disclosure';
import { popoverSurface } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import type { MerchantPolicyRow } from '@/lib/returns/policies';

const initial: ActionState = {};

function windowLabel(days: number | null): string {
  if (days == null) return 'No window';
  return days === 1 ? '1 day' : `${days} days`;
}

function policyMeta(policy: MerchantPolicyRow): string {
  if (policy.hasOverride) {
    return `Custom · catalog default ${windowLabel(policy.seededDays).toLowerCase()}`;
  }
  if (policy.seededDays != null) return `Default ${windowLabel(policy.seededDays).toLowerCase()}`;
  return 'No default window';
}

function matchesQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return name.toLowerCase().includes(q);
}

/**
 * One retailer, edited where it is read.
 *
 * This replaced a panel: clicking a row used to open a bordered card above the
 * list carrying a heading, a labelled field, a Save button and a close button,
 * in order to change one number. That is laws 11 and 12 broken together -- a
 * second box inside the settings card, and a form standing in for the value it
 * edits. The number is now the input, in the row, at the size it is read at.
 *
 * Commit is on Enter or on leaving the field, and only when it actually
 * changed; Escape puts it back. Blur-to-commit is safe here and would not be
 * everywhere: the field is one integer, the change is reversible from the same
 * row, and there is no partially-valid state to save by accident.
 */
function PolicyRow({
  policy,
  autoFocus = false,
}: {
  policy: MerchantPolicyRow;
  autoFocus?: boolean;
}) {
  const [state, action, pending] = useActionState(saveMerchantReturnPolicy, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const committed = policy.effectiveDays == null ? '' : String(policy.effectiveDays);

  function commit(event: React.FocusEvent<HTMLInputElement>) {
    if (event.target.value.trim() !== committed) formRef.current?.requestSubmit();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.currentTarget.value = committed;
      event.currentTarget.blur();
    }
  }

  return (
    <li className="row-pad">
      <form ref={formRef} action={action} className="flex items-center gap-3">
        <input type="hidden" name="merchant_id" value={policy.merchantId} />
        <input type="hidden" name="intent" value="save" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-ink">{policy.name}</p>
          <p className="truncate text-small text-ink-muted">{policyMeta(policy)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <InlineInput
            name="return_window_days"
            inputMode="numeric"
            aria-label={`Return window for ${policy.name}, in days`}
            placeholder="None"
            defaultValue={committed}
            key={`${policy.merchantId}-${committed}`}
            autoFocus={autoFocus}
            onBlur={commit}
            onKeyDown={onKeyDown}
            disabled={pending}
            className="tabular w-16 text-right font-medium"
          />
          <span className="text-small text-ink-muted">days</span>
        </div>
        {policy.hasOverride && (
          <Button
            type="submit"
            name="intent"
            value="reset"
            size="sm"
            variant="ghost"
            disabled={pending}
          >
            Use default
          </Button>
        )}
      </form>
      {state.error && <FieldError>{state.error}</FieldError>}
    </li>
  );
}

/**
 * Adding a retailer is the case law 12 leaves alone: two fields that have to
 * arrive together, creating something that does not exist yet to be edited in
 * place. It keeps the form and loses the box -- a heading and space say
 * "these belong together" as well as a dashed border did, and do not argue
 * with the card around them. Law 11.
 */
function AddMerchantForm({
  initialName,
  onCancel,
}: {
  initialName: string;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState(createMerchantReturnPolicy, initial);

  return (
    <Group
      title="Add a retailer"
      action={
        <button
          type="button"
          onClick={onCancel}
          className="press rounded-control p-1 text-ink-muted hover:bg-sunken hover:text-ink"
          aria-label="Cancel"
        >
          <X className="size-4" strokeWidth={1.75} />
        </button>
      }
    >
      <form action={action} className="flex flex-wrap items-end gap-(--field-gap)">
        <div className="min-w-40 flex-1">
          <Label htmlFor="new-merchant-name">Name</Label>
          <Input
            id="new-merchant-name"
            name="name"
            required
            maxLength={80}
            defaultValue={initialName}
            autoFocus
          />
        </div>
        <div className="w-32">
          <Label htmlFor="new-merchant-days">Window (days)</Label>
          <Input
            id="new-merchant-days"
            name="return_window_days"
            inputMode="numeric"
            placeholder="e.g. 30"
            defaultValue="30"
          />
        </div>
        <Button type="submit" pending={pending}>
          {pending ? 'Adding…' : 'Add'}
        </Button>
      </form>
      <FieldError>{state.error}</FieldError>
      {state.message && <p className="text-small text-positive">{state.message}</p>}
    </Group>
  );
}

export function ReturnPoliciesSection({ policies }: { policies: MerchantPolicyRow[] }) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addName, setAddName] = useState('');
  const [, startTransition] = useTransition();

  const selected = useMemo(
    () => policies.find((p) => p.merchantId === selectedId) ?? null,
    [policies, selectedId],
  );

  const customized = useMemo(
    () =>
      policies
        .filter((p) => p.hasOverride || p.onOrders)
        .sort((a, b) => {
          if (a.hasOverride !== b.hasOverride) return a.hasOverride ? -1 : 1;
          if (a.onOrders !== b.onOrders) return a.onOrders ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
    [policies],
  );

  /**
   * What the list shows: everything already customized, plus whatever was just
   * picked out of the search if it is not in that set yet. Picking a retailer
   * with no override used to have nowhere to go except a panel; now it becomes
   * a row, is edited there, and stays once it has a window of its own.
   */
  const rows = useMemo(() => {
    if (!selected || customized.some((p) => p.merchantId === selected.merchantId)) {
      return customized;
    }
    return [selected, ...customized];
  }, [selected, customized]);

  const matches = useMemo(() => {
    const filtered = policies.filter((p) => matchesQuery(p.name, deferredQuery));
    // Prefer order merchants, then overrides, then alphabetical — but only when
    // the query is empty; with a query, relevance is just name match order.
    if (!deferredQuery.trim()) {
      return filtered
        .slice()
        .sort((a, b) => {
          if (a.onOrders !== b.onOrders) return a.onOrders ? -1 : 1;
          if (a.hasOverride !== b.hasOverride) return a.hasOverride ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
        .slice(0, 8);
    }
    return filtered.slice(0, 12);
  }, [policies, deferredQuery]);

  const exactMatch = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return null;
    return policies.find((p) => p.name.toLowerCase() === q) ?? null;
  }, [policies, deferredQuery]);

  const canAdd =
    deferredQuery.trim().length >= 2 && !exactMatch;

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  function selectPolicy(policy: MerchantPolicyRow) {
    startTransition(() => {
      setSelectedId(policy.merchantId);
      setQuery(policy.name);
      setOpen(false);
      setAdding(false);
    });
  }

  function startAdd(name: string) {
    setAdding(true);
    setAddName(name.trim());
    setSelectedId(null);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (event.key === 'ArrowDown' || event.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (!open) return;

    const optionCount = matches.length + (canAdd ? 1 : 0);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((h) => (optionCount === 0 ? 0 : (h + 1) % optionCount));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) =>
        optionCount === 0 ? 0 : (h - 1 + optionCount) % optionCount,
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (highlight < matches.length) {
        const policy = matches[highlight];
        if (policy) selectPolicy(policy);
      } else if (canAdd) {
        startAdd(query);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-body text-ink-muted">
        Deadlines use delivery date plus this window. Search a retailer to edit its policy,
        or add one that isn’t listed. Your changes stay private to you.
      </p>

      <div ref={rootRef} className="relative space-y-3">
        <div>
          <Label htmlFor={`${listId}-search`}>Find a retailer</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
              strokeWidth={1.75}
              aria-hidden
            />
            <Input
              ref={inputRef}
              id={`${listId}-search`}
              role="combobox"
              aria-expanded={open}
              aria-controls={`${listId}-listbox`}
              aria-autocomplete="list"
              aria-activedescendant={
                open
                  ? highlight < matches.length
                    ? `${listId}-opt-${highlight}`
                    : canAdd
                      ? `${listId}-add`
                      : undefined
                  : undefined
              }
              value={query}
              placeholder="Start typing a store name…"
              className="pl-9"
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlight(0);
                setOpen(true);
                setAdding(false);
              }}
              onFocus={() => {
                setHighlight(0);
                setOpen(true);
              }}
              onKeyDown={onKeyDown}
              autoComplete="off"
            />
          </div>
        </div>

        {open && (
          <ul
            id={`${listId}-listbox`}
            role="listbox"
            className={cn(
              popoverSurface,
              'absolute z-20 mt-1 max-h-64 w-full overflow-auto',
            )}
          >
            {matches.length === 0 && !canAdd ? (
              <li className="px-3 py-3 text-body text-ink-muted">
                No matches. Type at least 2 characters to add a new retailer.
              </li>
            ) : (
              <>
                {matches.map((policy, index) => (
                  <li key={policy.merchantId} role="presentation">
                    <button
                      type="button"
                      id={`${listId}-opt-${index}`}
                      role="option"
                      aria-selected={highlight === index}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-body transition-colors',
                        highlight === index ? 'bg-accent-tint text-accent' : 'hover:bg-canvas',
                      )}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => selectPolicy(policy)}
                    >
                      <span className="min-w-0 truncate font-medium text-ink">
                        {policy.name}
                        {policy.onOrders && (
                          <span className="ml-2 text-micro font-normal text-ink-muted">
                            in your orders
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 tabular text-small text-ink-muted">
                        {windowLabel(policy.effectiveDays)}
                        {policy.hasOverride ? ' · custom' : ''}
                      </span>
                    </button>
                  </li>
                ))}
                {canAdd && (
                  <li role="presentation">
                    <button
                      type="button"
                      id={`${listId}-add`}
                      role="option"
                      aria-selected={highlight === matches.length}
                      className={cn(
                        'flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-body transition-colors',
                        highlight === matches.length
                          ? 'bg-accent-tint text-accent'
                          : 'text-accent hover:bg-canvas',
                      )}
                      onMouseEnter={() => setHighlight(matches.length)}
                      onClick={() => startAdd(query)}
                    >
                      <Plus className="size-4 shrink-0" strokeWidth={1.75} />
                      <span>
                        Add “{query.trim()}” as a new retailer
                      </span>
                    </button>
                  </li>
                )}
              </>
            )}
          </ul>
        )}
      </div>

      {adding && (
        <AddMerchantForm
          initialName={addName}
          onCancel={() => {
            setAdding(false);
            setAddName('');
          }}
        />
      )}

      {/*
        * One list, not a list and a panel above it. A retailer picked out of
        * the search that has no policy yet joins the top of the same list and
        * is edited in the same row as the rest, which is why selecting one no
        * longer opens anything. Law 12.
        */}
      <Group title="Your policies">
        {rows.length === 0 ? (
          <p className="text-body text-ink-muted">
            Nothing customized yet. Search above when you want to change a window — seeded
            defaults apply until then.
          </p>
        ) : (
          // Divides and space, no frame: the card around this already said
          // these belong together. Law 11.
          <ul className="divide-y divide-border">
            {rows.map((policy) => (
              <PolicyRow
                key={policy.merchantId}
                policy={policy}
                autoFocus={policy.merchantId === selectedId}
              />
            ))}
          </ul>
        )}
      </Group>
    </div>
  );
}
