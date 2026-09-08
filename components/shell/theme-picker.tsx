'use client';

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { Palette } from 'lucide-react';
import { cn } from '@/lib/cn';
import { usePopover } from '@/lib/use-popover';
import { setTheme } from '@/app/theme-actions';
import { setDensity } from '@/app/density-actions';
import { THEMES, type ThemeChoice, type ThemeId } from '@/lib/theme';
import { DENSITIES, parseDensity, type Density } from '@/lib/density';

/**
 * The density attribute on <html> is the store; this component only reads it.
 * The server put it there from the cookie, a click writes it back, and an
 * observer on the attribute is what makes the radio group follow.
 */
function subscribeDensity(onStoreChange: () => void): () => void {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-density'],
  });
  return () => observer.disconnect();
}
function getDensitySnapshot(): Density {
  return parseDensity(document.documentElement.getAttribute('data-density'));
}
function getDensityServerSnapshot(): Density {
  return 'comfortable';
}

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

  /**
   * The density dial lives in the same panel: it is the other "how does this
   * room feel" control, and a second icon in the bar would be one too many.
   * Read from the document after mount -- the server put it on <html> from
   * the cookie -- and written straight back to it on click, with the cookie
   * following behind, so the whole app tightens before the round trip.
   */
  const density = useSyncExternalStore(
    subscribeDensity,
    getDensitySnapshot,
    getDensityServerSnapshot,
  );
  function chooseDensity(next: Density) {
    const root = document.documentElement;
    if (next === 'comfortable') root.removeAttribute('data-density');
    else root.setAttribute('data-density', next);
    startTransition(() => {
      void setDensity(next);
    });
  }

  const chosen = override !== undefined ? override : value;
  const showing = preview !== undefined ? preview : chosen;
  /** Has anything happened *on this page* -- a hover, or a click? */
  const touched = preview !== undefined || override !== undefined;

  /**
   * One place writes to the document, and it is driven by state rather than by
   * a handler -- so hovering a swatch, choosing one, and closing without
   * choosing all go through the same path and cannot disagree.
   *
   * It writes only once something has actually happened here. On mount the
   * document already carries whatever the server rendered from the cookie,
   * and re-asserting it from `value` is how a chosen theme got lost: `value`
   * is the account's answer, null means "follow the system", and null is also
   * what the account returns when it simply does not know -- as it did for
   * every request while the `theme` column was missing from
   * core.account_settings. This component then removed `data-theme` on every
   * mount, so the first paint of each workspace was right and hydration threw
   * it away and fell back to prefers-color-scheme. Switching module looked
   * like it reset the theme to dark, because on a dark machine that is exactly
   * what it did.
   */
  useEffect(() => {
    if (!touched) return;
    const root = document.documentElement;
    if (showing) root.setAttribute('data-theme', showing);
    else root.removeAttribute('data-theme');
  }, [touched, showing]);

  /**
   * The account is the truth; the cookie is a device-local mirror.
   *
   * On a machine that has never seen this account the cookie is absent, so the
   * server rendered the system default and the first paint was the wrong
   * theme. Apply it and repair the cookie, so this page is right and so is the
   * next one. Only ever for a real stored choice: null is not evidence that
   * the account wants the system default, only that it is not saying.
   */
  useEffect(() => {
    if (!value) return;
    const root = document.documentElement;
    if (root.getAttribute('data-theme') === value) return;
    root.setAttribute('data-theme', value);
    startTransition(() => {
      void setTheme(value);
    });
  }, [value]);

  usePopover({ open, onClose: close, panelRef, triggerRef });

  /**
   * Whether a focus landing on a swatch is the person's doing.
   *
   * Opening the panel moves focus into it, and the first thing in it is Paper
   * -- so previewing on focus meant that merely tapping the palette repainted
   * the whole app in a light theme, whatever theme you were in. On a pointer
   * there is a hover afterwards to correct it, which is why this survived on a
   * desktop and was reported from a phone.
   *
   * Declared after `usePopover` so its effect runs after the one that moves
   * focus: by the time this flips, the opening focus has already been and
   * gone. Every focus after it is a Tab or an arrow, and those should preview.
   */
  const settled = useRef(false);
  useEffect(() => {
    if (!open) {
      settled.current = false;
      return;
    }
    settled.current = true;
  }, [open]);

  /** A focus is a preview only once the panel has finished opening. */
  function previewOnFocus(next: ThemeChoice) {
    if (settled.current) setPreview(next);
  }

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
          open
            ? 'bg-accent-tint text-accent'
            : 'text-shell-muted hover:bg-shell-hover hover:text-shell-ink',
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
              onFocus={() => previewOnFocus(theme.id as ThemeId)}
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
            onFocus={() => previewOnFocus(null)}
            aria-pressed={chosen === null}
            className={cn(
              'mt-1 flex w-full items-center gap-2.5 rounded-lg border-t border-border px-2 pb-1.5 pt-2 text-left text-ui transition-colors',
              chosen === null ? 'text-accent' : 'text-ink-muted hover:text-ink',
            )}
          >
            Follow the system
          </button>

          <p className="mt-1 border-t border-border px-2 pb-1.5 pt-2.5 text-micro font-semibold uppercase tracking-wider text-ink-muted">
            Density
          </p>
          <div role="radiogroup" aria-label="Density" className="flex gap-1 px-1 pb-1">
            {DENSITIES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={density === option.id}
                onClick={() => chooseDensity(option.id)}
                className={cn(
                  'press flex-1 rounded-md px-2 py-1.5 text-small font-medium transition-colors',
                  density === option.id
                    ? 'bg-accent-tint text-accent'
                    : 'text-ink-muted hover:bg-sunken hover:text-ink',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
