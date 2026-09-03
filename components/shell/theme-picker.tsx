'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Palette } from 'lucide-react';
import { cn } from '@/lib/cn';
import { usePopover } from '@/lib/use-popover';
import { setTheme } from '@/app/theme-actions';
import { THEMES, type ThemeChoice, type ThemeId } from '@/lib/theme';

/**
 * Choosing the room.
 *
 * The swatch previews live on hover -- you see the theme before you move into
 * it -- and applying is instant on the document, with the server action
 * following behind. Waiting a round trip to find out whether a colour scheme
 * took is the kind of latency that makes a preference feel broken.
 *
 * "Follow the system" is a real option and the default. It is not the same as
 * choosing light, and a person who has never opened this should get whatever
 * their OS is set to.
 */
export function ThemePicker({ value }: { value: ThemeChoice }) {
  const [open, setOpen] = useState(false);
  // undefined means "whatever the account says"; anything else is a choice
  // made on this page since it loaded. Derived rather than copied into state,
  // so a change from the server cannot be silently ignored.
  const [override, setOverride] = useState<ThemeChoice | undefined>(undefined);
  const [preview, setPreview] = useState<ThemeChoice | undefined>(undefined);
  const [, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const chosen = override !== undefined ? override : value;
  const showing = preview !== undefined ? preview : chosen;

  /**
   * One place writes to the document, and it is driven by state rather than by
   * a handler -- so hovering a swatch, choosing one, and closing without
   * choosing all go through the same path and cannot disagree.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (showing) root.setAttribute('data-theme', showing);
    else root.removeAttribute('data-theme');
  }, [showing]);

  /**
   * The account is the truth; the cookie is a device-local mirror.
   *
   * On a machine that has never seen this account the cookie is absent, so the
   * server rendered the system default and the first paint was the wrong
   * theme. Repair the cookie once, quietly, so the next one is right. No state
   * is touched -- `chosen` already reflects the account.
   */
  useEffect(() => {
    if (!value) return;
    if (document.documentElement.getAttribute('data-theme') === value) return;
    startTransition(() => {
      void setTheme(value);
    });
  }, [value]);

  usePopover({ open, onClose: close, panelRef, triggerRef });

  function close() {
    setOpen(false);
    setPreview(undefined);
  }

  function choose(next: ThemeChoice) {
    setOverride(next);
    setPreview(undefined);
    setOpen(false);
    startTransition(() => {
      void setTheme(next);
    });
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Theme"
        className={cn(
          'press flex size-8 items-center justify-center rounded-full transition-colors',
          open ? 'bg-accent-tint text-accent' : 'text-ink-muted hover:bg-sunken hover:text-ink',
        )}
      >
        <Palette className="size-4" strokeWidth={1.75} aria-hidden />
        <span className="sr-only">Theme</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Theme"
          tabIndex={-1}
          onMouseLeave={() => setPreview(undefined)}
          className="fixed inset-x-4 top-16 z-50 rounded-card border border-border bg-raised p-2 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-64"
        >
          <p className="px-2 pb-1.5 pt-1 text-micro font-semibold uppercase tracking-wider text-ink-muted">
            Theme
          </p>
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              onClick={() => choose(theme.id as ThemeId)}
              onMouseEnter={() => setPreview(theme.id as ThemeId)}
              onFocus={() => setPreview(theme.id as ThemeId)}
              aria-pressed={chosen === theme.id}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                showing === theme.id ? 'bg-accent-tint' : 'hover:bg-sunken',
              )}
            >
              <span
                className="size-5 shrink-0 rounded-md border border-border-strong"
                style={{ background: theme.swatch }}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block text-ui font-medium',
                    chosen === theme.id ? 'text-accent' : 'text-ink',
                  )}
                >
                  {theme.label}
                </span>
                <span className="block text-small leading-snug text-ink-muted">{theme.mood}</span>
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => choose(null)}
            onMouseEnter={() => setPreview(null)}
            onFocus={() => setPreview(null)}
            aria-pressed={chosen === null}
            className={cn(
              'mt-1 flex w-full items-center gap-2.5 rounded-lg border-t border-border px-2 pb-1.5 pt-2 text-left text-ui transition-colors',
              chosen === null ? 'text-accent' : 'text-ink-muted hover:text-ink',
            )}
          >
            Follow the system
          </button>
        </div>
      )}
    </div>
  );
}
