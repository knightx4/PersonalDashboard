'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/field';
import { resolveMerchant, suggestMerchants, type MerchantOption } from '@/lib/merchants/suggest';

/**
 * Type the merchant; known ones are suggested as you go, and anything else is
 * saved as a new merchant.
 *
 * Note b91e07f5 replaced a select with an "Other (type a name)" escape hatch:
 * picking from a long list and switching modes for a new shop was two
 * controls for one answer. What the form submits is still the two fields the
 * action already reads, so the server side is unchanged.
 */
export function MerchantField({ id, merchants }: { id: string; merchants: MerchantOption[] }) {
  const listId = `${id}-list`;
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  // -1 is nothing highlighted, so Enter on a new name submits the name rather
  // than swapping in the first suggestion.
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => suggestMerchants(merchants, text), [merchants, text]);
  const resolved = resolveMerchant(merchants, text);

  // Close when the click lands outside.
  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const choose = (merchant: MerchantOption) => {
    setText(merchant.name);
    setOpen(false);
    setActive(-1);
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
      // Only swallow Enter when a suggestion has been arrowed to, so it still
      // submits the form the rest of the time.
      event.preventDefault();
      choose(matches[active]);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') setOpen(false);
  }

  const showList = open && matches.length > 0;

  return (
    <div ref={wrapRef} className="relative">
      <Input
        id={id}
        value={text}
        placeholder="Type a merchant"
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(event) => {
          setText(event.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <input type="hidden" name="merchant_id" value={resolved.merchantId ?? ''} />
      <input type="hidden" name="custom_merchant_name" value={resolved.customName ?? ''} />

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Merchants"
          // ui-ok: a floating listbox, drawn as components/ui/timezone-field.tsx draws its own
          className="popover-panel absolute z-overlay mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-raised py-1 shadow-lg"
        >
          {matches.map((merchant, index) => (
            <li
              key={merchant.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // mousedown, not click: blur would close the list first.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(merchant);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'cursor-pointer truncate px-3 py-1.5 text-ui',
                index === active ? 'bg-accent-tint text-accent' : 'text-ink',
              )}
            >
              {merchant.name}
            </li>
          ))}
        </ul>
      )}

      {resolved.customName && (
        <p className="mt-1 text-micro text-ink-muted">
          New merchant: saved as {resolved.customName}.
        </p>
      )}
    </div>
  );
}
