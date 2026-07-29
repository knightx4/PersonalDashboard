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
import { Check, Plus, Search, X } from 'lucide-react';
import {
  createMerchantReturnPolicy,
  saveMerchantReturnPolicy,
  type ActionState,
} from '@/app/(app)/returns/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/field';
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

function EditPolicyForm({
  policy,
  onDone,
}: {
  policy: MerchantPolicyRow;
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(saveMerchantReturnPolicy, initial);
  const defaultValue =
    policy.effectiveDays == null ? '' : String(policy.effectiveDays);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-canvas/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">{policy.name}</p>
          <p className="text-[12px] text-ink-muted">{policyMeta(policy)}</p>
        </div>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="rounded-md p-1 text-ink-muted hover:bg-surface hover:text-ink"
            aria-label="Clear selection"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="merchant_id" value={policy.merchantId} />
        <div className="min-w-[8rem] flex-1">
          <Label htmlFor={`window-${policy.merchantId}`}>Return window (days)</Label>
          <Input
            id={`window-${policy.merchantId}`}
            name="return_window_days"
            inputMode="numeric"
            placeholder="None"
            defaultValue={defaultValue}
            key={`${policy.merchantId}-${defaultValue}-${policy.hasOverride}`}
            autoFocus
          />
        </div>
        <Button type="submit" name="intent" value="save" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {policy.hasOverride && (
          <Button
            type="submit"
            name="intent"
            value="reset"
            size="sm"
            variant="secondary"
            disabled={pending}
          >
            Use default
          </Button>
        )}
      </form>
      <FieldError>{state.error}</FieldError>
      {state.message && <p className="text-[12px] text-positive">{state.message}</p>}
    </div>
  );
}

function AddMerchantForm({
  initialName,
  onCancel,
}: {
  initialName: string;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState(createMerchantReturnPolicy, initial);

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-border bg-canvas/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">Add a retailer</p>
          <p className="text-[12px] text-ink-muted">
            Creates a personal merchant with its own return window.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md p-1 text-ink-muted hover:bg-surface hover:text-ink"
          aria-label="Cancel"
        >
          <X className="size-4" strokeWidth={1.75} />
        </button>
      </div>
      <form action={action} className="space-y-3">
        <div>
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
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[8rem] flex-1">
            <Label htmlFor="new-merchant-days">Return window (days)</Label>
            <Input
              id="new-merchant-days"
              name="return_window_days"
              inputMode="numeric"
              placeholder="e.g. 30"
              defaultValue="30"
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Adding…' : 'Add retailer'}
          </Button>
        </div>
      </form>
      <FieldError>{state.error}</FieldError>
      {state.message && <p className="text-[12px] text-positive">{state.message}</p>}
    </div>
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
      <p className="text-sm text-ink-muted">
        Deadlines use delivery date plus this window. Search a retailer to edit its policy,
        or add one that isn’t listed. Your changes stay private to you.
      </p>

      <div ref={rootRef} className="relative space-y-3">
        <div>
          <Label htmlFor={`${listId}-search`}>Find a retailer</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
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
            className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-surface shadow-sm"
          >
            {matches.length === 0 && !canAdd ? (
              <li className="px-3 py-3 text-sm text-ink-muted">
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
                        'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors',
                        highlight === index ? 'bg-brand-tint text-brand' : 'hover:bg-canvas',
                      )}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => selectPolicy(policy)}
                    >
                      <span className="min-w-0 truncate font-medium text-ink">
                        {policy.name}
                        {policy.onOrders && (
                          <span className="ml-2 text-[11px] font-normal text-ink-muted">
                            in your orders
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 tabular text-[12px] text-ink-muted">
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
                        'flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm transition-colors',
                        highlight === matches.length
                          ? 'bg-brand-tint text-brand'
                          : 'text-brand hover:bg-canvas',
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

      {selected && !adding && (
        <EditPolicyForm
          key={selected.merchantId}
          policy={selected}
          onDone={() => {
            setSelectedId(null);
            setQuery('');
            inputRef.current?.focus();
          }}
        />
      )}

      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Your policies
        </h3>
        {customized.length === 0 ? (
          <p className="text-sm text-ink-faint">
            Nothing customized yet. Search above when you want to change a window — seeded
            defaults apply until then.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {customized.map((policy) => {
              const active = policy.merchantId === selectedId;
              return (
                <li key={policy.merchantId}>
                  <button
                    type="button"
                    onClick={() => selectPolicy(policy)}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-canvas',
                      active && 'bg-brand-tint/50',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{policy.name}</p>
                      <p className="truncate text-[12px] text-ink-muted">
                        {policy.hasOverride ? 'Custom' : 'Default'}
                        {policy.onOrders ? ' · in your orders' : ''}
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-[13px] font-medium text-ink">
                      {windowLabel(policy.effectiveDays)}
                    </span>
                    {active ? (
                      <Check className="size-4 shrink-0 text-brand" strokeWidth={1.75} />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
