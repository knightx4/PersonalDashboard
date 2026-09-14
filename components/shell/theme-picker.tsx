'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { Check, Palette } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Popover } from '@/components/ui/popover';
import { usePopover } from '@/lib/use-popover';
import { setTheme } from '@/app/theme-actions';
import { setDensity } from '@/app/density-actions';
import {
  formatTheme,
  hueOf,
  modeOf,
  THEME_COLOURS,
  type GeneratedTheme,
  type Theme,
  type ThemeMode,
} from '@/lib/theme';
import { applyTheme } from '@/lib/theme/apply';
import { generatePalette } from '@/lib/theme/palette';
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
 * Choosing the room: light or dark, and a colour.
 *
 * Two choices instead of four named themes. The switch says which polarity and
 * the swatches say which colour, and every combination of the two is a theme,
 * generated from the palettes that were written by hand. Lightbox sits beside
 * the switch as its own button, because its page and its cards are opposite
 * polarities and it cannot be said as a mode and a colour at all -- #422.
 *
 * Everything previews live on hover -- you see the theme before you move into
 * it -- and applying is instant on the document, with the server action
 * following behind. Waiting a round trip to find out whether a colour scheme
 * took is the kind of latency that makes a preference feel broken.
 *
 * "Follow the system" is a real option and the default. It is not the same as
 * choosing light, and a person who has never opened this should get whatever
 * their OS is set to.
 */

/** Two themes are the same choice when they would store the same string. */
function same(a: Theme, b: Theme): boolean {
  return formatTheme(a) === formatTheme(b);
}

export function ThemePicker({ value }: { value: Theme }) {
  const [open, setOpen] = useState(false);
  // undefined means "whatever the account says"; anything else is a choice
  // made on this page since it loaded. Derived rather than copied into state,
  // so a change from the server cannot be silently ignored.
  const [override, setOverride] = useState<Theme | undefined>(undefined);
  const [preview, setPreview] = useState<Theme | undefined>(undefined);
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

  /** The polarity and the colour the swatches and the switch are built from. */
  const mode = modeOf(showing);
  const hue = hueOf(showing);

  /**
   * One place writes to the document, and it is driven by state rather than by
   * a handler -- so hovering a swatch, choosing one, and closing without
   * choosing all go through the same path and cannot disagree.
   *
   * It writes only once something has actually happened here. On mount the
   * document already carries whatever the server rendered from the cookie,
   * and re-asserting it from `value` is how a chosen theme got lost: `value`
   * is the account's answer, following the system is what it says when
   * nothing was chosen, and it is also what it says when it simply does not
   * know -- as it did for every request while the `theme` column was missing
   * from core.account_settings. This component then cleared the theme on every
   * mount, so the first paint of each workspace was right and hydration threw
   * it away and fell back to prefers-color-scheme. Switching module looked
   * like it reset the theme to dark, because on a dark machine that is exactly
   * what it did.
   */
  useEffect(() => {
    if (!touched) return;
    applyTheme(document.documentElement, showing);
  }, [touched, showing]);

  /**
   * The account is the truth; the cookie is a device-local mirror.
   *
   * On a machine that has never seen this account the cookie is absent, so the
   * server rendered the system default and the first paint was the wrong
   * theme. Apply it and repair the cookie, so this page is right and so is the
   * next one. Only ever for a real stored choice: following the system is not
   * evidence that the account wants the system default, only that it is not
   * saying.
   */
  const stored = formatTheme(value);
  useEffect(() => {
    if (!stored) return;
    const root = document.documentElement;
    if (root.getAttribute('data-theme-choice') === stored) return;
    applyTheme(root, value);
    startTransition(() => {
      void setTheme(stored);
    });
  }, [stored, value]);

  usePopover({ open, onClose: close, panelRef, triggerRef });

  /**
   * Whether a focus landing on a control is the person's doing.
   *
   * Opening the panel moves focus into it, and the first thing in it is the
   * light switch -- so previewing on focus meant that merely tapping the
   * palette repainted the whole app light, whatever theme you were in. On a
   * pointer there is a hover afterwards to correct it, which is why this
   * survived on a desktop and was reported from a phone.
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
  function previewOnFocus(next: Theme) {
    if (settled.current) setPreview(next);
  }

  function close() {
    setOpen(false);
    setPreview(undefined);
  }

  function choose(next: Theme) {
    setOverride(next);
    setPreview(undefined);
    setOpen(false);
    startTransition(() => {
      void setTheme(formatTheme(next));
    });
  }

  /** Changing the polarity keeps the colour, and the other way round. */
  const inMode = (next: ThemeMode): GeneratedTheme => ({ kind: 'generated', mode: next, hue });
  const inHue = (next: number | null): GeneratedTheme => ({ kind: 'generated', mode, hue: next });

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
        <Popover
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Theme"
          tabIndex={-1}
          onMouseLeave={() => setPreview(undefined)}
          padding="menu"
          className="sm:w-64"
        >
          <p className="px-2 pb-1.5 pt-1 text-micro font-semibold uppercase tracking-wider text-ink-muted">
            Theme
          </p>

          <div role="radiogroup" aria-label="Light or dark" className="flex gap-1 px-1 pb-1">
            {(['light', 'dark'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={showing.kind === 'generated' && mode === option}
                onClick={() => choose(inMode(option))}
                onMouseEnter={() => setPreview(inMode(option))}
                onFocus={() => previewOnFocus(inMode(option))}
                className={cn(
                  'press flex-1 rounded-md px-2 py-1.5 text-small font-medium capitalize transition-colors',
                  showing.kind === 'generated' && mode === option
                    ? 'bg-accent-tint text-accent'
                    : 'text-ink-muted hover:bg-sunken hover:text-ink',
                )}
              >
                {option}
              </button>
            ))}
            {/* Lightbox cannot be said as a mode and a colour -- its page and
                its cards are opposite polarities -- so it stays a button of
                its own beside the switch rather than being dropped. */}
            <button
              type="button"
              aria-pressed={showing.kind === 'written' && showing.id === 'lightbox'}
              onClick={() => choose({ kind: 'written', id: 'lightbox' })}
              onMouseEnter={() => setPreview({ kind: 'written', id: 'lightbox' })}
              onFocus={() => previewOnFocus({ kind: 'written', id: 'lightbox' })}
              title="Lit sheets on a blue-black bench"
              className={cn(
                'press flex-1 rounded-md px-2 py-1.5 text-small font-medium transition-colors',
                showing.kind === 'written' && showing.id === 'lightbox'
                  ? 'bg-accent-tint text-accent'
                  : 'text-ink-muted hover:bg-sunken hover:text-ink',
              )}
            >
              Lightbox
            </button>
          </div>

          <p className="px-2 pb-1.5 pt-2 text-micro font-semibold uppercase tracking-wider text-ink-muted">
            Colour
          </p>

          <div className="flex flex-wrap gap-1.5 px-2 pb-1">
            <Swatch
              theme={inHue(null)}
              label="No colour"
              chosen={same(showing, inHue(null))}
              onChoose={choose}
              onPreview={setPreview}
              onPreviewFocus={previewOnFocus}
            />
            {THEME_COLOURS.map((colour) => (
              <Swatch
                key={colour.id}
                theme={inHue(colour.hue)}
                label={colour.label}
                chosen={same(showing, inHue(colour.hue))}
                onChoose={choose}
                onPreview={setPreview}
                onPreviewFocus={previewOnFocus}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => choose({ kind: 'system' })}
            onMouseEnter={() => setPreview({ kind: 'system' })}
            onFocus={() => previewOnFocus({ kind: 'system' })}
            aria-pressed={showing.kind === 'system'}
            className={cn(
              'mt-1 flex w-full items-center gap-2.5 rounded-lg border-t border-border px-2 pb-1.5 pt-2 text-left text-ui transition-colors',
              showing.kind === 'system' ? 'text-accent' : 'text-ink-muted hover:text-ink',
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
        </Popover>
      )}
    </div>
  );
}

/**
 * One colour, shown as the colour it actually produces.
 *
 * The accent rather than the ground: the grounds of the five are near-greys a
 * few thousandths of chroma apart, so a row of them would be a row of the same
 * square. The accent is what a person means when they say they want a green
 * app. "No colour" shows the ground instead, because that is what it is.
 */
function Swatch({
  theme,
  label,
  chosen,
  onChoose,
  onPreview,
  onPreviewFocus,
}: {
  theme: GeneratedTheme;
  label: string;
  chosen: boolean;
  onChoose: (theme: Theme) => void;
  onPreview: (theme: Theme) => void;
  onPreviewFocus: (theme: Theme) => void;
}) {
  const fill = useMemo(() => {
    const palette = generatePalette(theme.mode, theme.hue);
    return palette[theme.hue === null ? '--c-canvas' : '--c-accent-base'];
  }, [theme.mode, theme.hue]);

  return (
    <button
      type="button"
      onClick={() => onChoose(theme)}
      onMouseEnter={() => onPreview(theme)}
      onFocus={() => onPreviewFocus(theme)}
      aria-pressed={chosen}
      title={label}
      // ui-ok: hand-rolled-box -- a user's colour against a like ground needs
      // an edge, which is the case law 11 keeps the border for.
      className="press flex size-7 items-center justify-center rounded-md border border-border-strong transition-transform hover:scale-105"
      // ui-ok: raw-hex -- this is the generated colour itself, which is the
      // one thing on the screen that cannot be a token.
      style={{ background: fill }}
    >
      {chosen && <Check className="size-3.5 text-surface mix-blend-difference" strokeWidth={3} aria-hidden />}
      <span className="sr-only">{label}</span>
    </button>
  );
}
