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
  THEME_MODES,
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
 * Choosing the room, and a colour for it.
 *
 * Two choices instead of four named themes. The switch says which room --
 * light, dark, or Lightbox -- and the swatches say which colour, and every
 * combination of the two is a theme, generated from the palettes that were
 * written by hand. Lightbox is a room rather than a preset because its page
 * and its cards are opposite polarities, so it is reachable from neither of
 * the other two; it takes a colour like them, on its bench rather than on its
 * sheets.
 *
 * Nothing happens until you click. Hovering a swatch used to repaint the whole
 * app, so that you saw a theme before you moved into it; note c0cfc6ae asked
 * for that back, and the reason is what the preview costs on the way to
 * something else -- crossing the panel to reach the colour you want flickers
 * the app through every option you passed over, and the one you are trying to
 * compare against is the one you can never see. Dragging the hue strip still
 * repaints live, because a slider with no live feedback is not a slider, and
 * that is a press rather than a passing pointer.
 *
 * Choosing does not close the panel either. Colour, polarity and density are
 * settings people arrive at by trying two or three, and a panel that shut on
 * the first click made each attempt cost a reopen. It closes on a click
 * outside it, or on Escape -- `usePopover` holds both.
 *
 * Applying is instant on the document, with the server action following
 * behind. Waiting a round trip to find out whether a colour scheme took is the
 * kind of latency that makes a preference feel broken.
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
  /**
   * What a drag on the hue strip is showing, before it is let go of. The only
   * thing that previews now: every other control writes its choice on click.
   */
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
  /** Has anything happened *on this page* -- a drag, or a click? */
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

  function close() {
    setOpen(false);
    setPreview(undefined);
  }

  /**
   * Take a choice, and leave the panel up.
   *
   * What every control in here does, and what releasing the hue strip does.
   * Closing on a choice would mean the panel shut the first time you let go of
   * a drag -- the moment you are most likely to want another go at it -- and
   * the same is true of the swatches: the second colour is usually chosen
   * against the first.
   */
  function save(next: Theme) {
    setOverride(next);
    setPreview(undefined);
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
          padding="menu"
          className="sm:w-64"
        >
          <p className="px-2 pb-1.5 pt-1 text-micro font-semibold uppercase tracking-wider text-ink-muted">
            Theme
          </p>

          <div role="radiogroup" aria-label="Room" className="flex gap-1 px-1 pb-1">
            {THEME_MODES.map((option) => {
              // Following the system is not one of these, so nothing is
              // checked until a room has actually been chosen.
              const on = showing.kind !== 'system' && mode === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => save(inMode(option.id))}
                  title={option.mood}
                  className={cn(
                    'press flex-1 rounded-md px-2 py-1.5 text-small font-medium transition-colors',
                    on ? 'bg-accent-tint text-accent' : 'text-ink-muted hover:bg-sunken hover:text-ink',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <p className="px-2 pb-1.5 pt-2 text-micro font-semibold uppercase tracking-wider text-ink-muted">
            Colour
          </p>

          <div className="flex flex-wrap gap-1.5 px-2 pb-1">
            <Swatch
              theme={inHue(null)}
              label="No colour"
              chosen={same(showing, inHue(null))}
              onChoose={save}
            />
            {THEME_COLOURS.map((colour) => (
              <Swatch
                key={colour.id}
                theme={inHue(colour.hue)}
                label={colour.label}
                chosen={same(showing, inHue(colour.hue))}
                onChoose={save}
              />
            ))}
          </div>

          <HueStrip
            mode={mode}
            hue={hue}
            onMove={(next) => setPreview(inHue(next))}
            onRelease={(next) => save(inHue(next))}
          />

          <button
            type="button"
            onClick={() => save({ kind: 'system' })}
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
 * app. "No colour" shows the page ground instead, because that is what it is.
 *
 * The lit accent, specifically. In light and dark it is the same value as the
 * one on a card; on Lightbox it is the one that lands on the bench, and the
 * bench is what a colour moves there.
 */
function Swatch({
  theme,
  label,
  chosen,
  onChoose,
}: {
  theme: GeneratedTheme;
  label: string;
  chosen: boolean;
  onChoose: (theme: Theme) => void;
}) {
  const fill = useMemo(() => {
    const palette = generatePalette(theme.mode, theme.hue);
    return palette[theme.hue === null ? '--c-page' : '--c-accent-base-lit'];
  }, [theme.mode, theme.hue]);

  return (
    <button
      type="button"
      onClick={() => onChoose(theme)}
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

/**
 * The circle, past the presets.
 *
 * A strip rather than a ring, and it is the same thing: the hue circle cut at
 * zero and laid flat, which is what every colour picker does and the only
 * shape a finger, a mouse and an arrow key can all work. `input[type=range]`
 * brings all three of those with it, plus the value in the accessibility tree,
 * which a div with pointer handlers on it would have to be given by hand and
 * usually is not.
 *
 * The track is painted in the colours it actually produces -- the accent at
 * each hue, generated -- rather than a raw rainbow. A rainbow would promise
 * colours this app will not give you: the saturated yellow at the top of an
 * HSL gradient does not exist at the lightness the accent has to hold.
 *
 * Dragging repaints the whole app live, down the same preview path the
 * swatches use, and releasing saves.
 */
function HueStrip({
  mode,
  hue,
  onMove,
  onRelease,
}: {
  mode: ThemeMode;
  hue: number | null;
  onMove: (hue: number) => void;
  onRelease: (hue: number) => void;
}) {
  /**
   * Where the handle sits when no colour is chosen.
   *
   * It has to sit somewhere, and the app's own accent is a blue, so that is
   * the least surprising place for it to be waiting.
   */
  const at = hue ?? 260;

  const track = useMemo(() => {
    // Thirteen stops is every thirty degrees plus the wrap back to zero. The
    // browser interpolates between them in sRGB, which is close enough over
    // thirty degrees and far cheaper than a stop per degree.
    const stops = Array.from({ length: 13 }, (_, step) => {
      const degrees = (step * 30) % 360;
      return `${generatePalette(mode, degrees)['--c-accent-base-lit']} ${(step / 12) * 100}%`;
    });
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, [mode]);

  return (
    <div className="px-2 pb-1 pt-1.5">
      <input
        type="range"
        min={0}
        max={359}
        value={at}
        aria-label="Colour"
        onChange={(event) => onMove(Number(event.target.value))}
        onPointerUp={(event) => onRelease(Number(event.currentTarget.value))}
        onPointerCancel={(event) => onRelease(Number(event.currentTarget.value))}
        onKeyUp={(event) => onRelease(Number(event.currentTarget.value))}
        // ui-ok: hand-rolled-box -- the track is the colour circle itself, so
        // its edge is the control rather than a frame drawn round one.
        className="h-4 w-full cursor-pointer appearance-none rounded-pill border border-border-strong [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-surface [&::-moz-range-thumb]:bg-transparent [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface [&::-webkit-slider-thumb]:bg-transparent"
        // The gradient is generated, so it cannot be a class: it is a hundred
        // and eighty degrees of this app's own accent, not a stock rainbow.
        style={{ backgroundImage: track }}
      />
    </div>
  );
}
