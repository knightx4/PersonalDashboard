'use client';

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SectionLabel } from '@/components/ui/section-heading';
import { setTheme } from '@/app/theme-actions';
import { setDensity } from '@/app/density-actions';
import {
  formatTheme,
  hueOf,
  modeOf,
  THEME_CHOICE_ATTRIBUTE,
  COLOURWAYS,
  colourwayOf,
  THEME_POLARITIES,
  THEME_SURFACES,
  SKIES,
  auroraFor,
  isAurora,
  modeFor,
  partsOf,
  skyOf,
  surfaceOfSky,
  type Polarity,
  type Surface,
  type ColourwayId,
  type GeneratedTheme,
  type Theme,
  type ThemeMode,
} from '@/lib/theme';
import { POOL_TOKENS, WASH_LIFT, type Colourway } from '@/lib/theme/colourway';
import { DEFAULT_LANDSCAPE, DEFAULT_SKY, isLandscape, type Sky, type SkyId } from '@/lib/theme/sky';
import { applyTheme, shouldRepairTheme } from '@/lib/theme/apply';
import { generatePalette } from '@/lib/theme/palette';
import { DENSITIES, parseDensity, type Density } from '@/lib/density';
import { Tooltip } from '@/components/ui/tooltip';

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
 * Three choices instead of a list of named themes. The switch says light or
 * dark, the surface says Solid, Aurora or Landscapes, and the swatches say
 * which colour (in Solid) or which sky or scene (in the other two). Every
 * combination is a theme: Solid is generated from the palettes written by
 * hand, and the other two are the Aurora and Dawn blocks wearing a sky.
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

/**
 * Puts the account's theme on a device that has never seen it.
 *
 * Mounted once by the shell on every page, since the theme picker now lives on
 * the account page and the shell no longer carries it. Renders nothing.
 */
export function ThemeRepair({ value }: { value: Theme }) {
  const [, startTransition] = useTransition();
  /**
   * The account is the truth; the cookie is a device-local mirror.
   *
   * On a machine that has never seen this account the cookie is absent, so the
   * server rendered the system default and the first paint was the wrong
   * theme. Apply it and repair the cookie, so this page is right and so is the
   * next one.
   *
   * Only when the document is carrying no choice at all, though -- not merely
   * a different one. `value` arrives from a render, and saving a theme starts
   * a render, so the value that comes back can be the one from before the
   * write; a disagreement is as likely to be this effect holding the stale
   * copy as the document holding it. `shouldRepairTheme` is where that rule
   * and the reason for it live.
   */
  const stored = formatTheme(value);
  useEffect(() => {
    if (!stored) return;
    const root = document.documentElement;
    if (!shouldRepairTheme(root.getAttribute(THEME_CHOICE_ATTRIBUTE), stored)) return;
    applyTheme(root, value);
    startTransition(() => {
      void setTheme(stored);
    });
  }, [stored, value]);
  return null;
}

/** The theme controls, drawn in the page: room, surface, colour, density. */
export function ThemePicker({ value }: { value: Theme }) {
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

  /**
   * Each of the three controls moves its own axis and leaves the other two.
   *
   * A room is two answers -- light or dark, solid or lightbox -- so changing
   * one of them has to keep the other, which is what `partsOf` is for: read
   * the current room apart, replace one half, put it back together.
   */
  // Aurora and Landscapes are written themes rather than modes, so they are
  // read apart here instead of through `partsOf`. Which of the two a theme is
  // depends on its sky: a painted scene is a landscape.
  const aurora = isAurora(showing);
  const sky = skyOf(showing);
  const here: { polarity: Polarity; surface: Surface } = aurora
    ? { polarity: showing.id === 'dawn' ? 'light' : 'dark', surface: surfaceOfSky(sky) }
    : partsOf(mode);
  // The colour survives a change of room, which means carrying the colourway
  // and not just its hue: dropping it here would turn Ember into "330 degrees"
  // the first time somebody switched to dark, and the pools would go back to
  // the turned sweep without anything having been said about colour.
  const way = colourwayOf(showing) ?? undefined;
  // In Aurora and Landscapes the switch moves between night and dawn and keeps the sky.
  const inPolarity = (next: Polarity): Theme =>
    here.surface === 'solid'
      ? { kind: 'generated', mode: modeFor(next), hue, way }
      : auroraFor(next, sky);
  // Into Aurora or Landscapes keeps the polarity and the sky if it belongs
  // there, and otherwise starts from that surface's first sky, since a
  // colourway is not a sky. Back to Solid keeps the polarity and drops the sky.
  const skyFor = (next: Exclude<Surface, 'solid'>): SkyId =>
    aurora && surfaceOfSky(sky) === next ? sky : next === 'landscape' ? DEFAULT_LANDSCAPE : DEFAULT_SKY;
  const inSurface = (next: Surface): Theme =>
    next === 'solid'
      ? { kind: 'generated', mode: modeFor(here.polarity), hue, way }
      : auroraFor(here.polarity, skyFor(next));
  /** The strip and "no colour": a hue with no name for its pools. */
  const inHue = (next: number | null): GeneratedTheme => ({ kind: 'generated', mode, hue: next });
  const inWay = (next: Colourway): GeneratedTheme => ({
    kind: 'generated',
    mode,
    hue: next.hue,
    way: next.id as ColourwayId,
  });

  return (
    <div role="group" aria-label="Theme">
          <SectionLabel className="pb-1.5">Light or dark</SectionLabel>

          <div role="radiogroup" aria-label="Light or dark" className="flex gap-1 pb-1">
            {THEME_POLARITIES.map((option) => {
              // Following the system is not one of these, so nothing is
              // checked until a room has actually been chosen.
              const on = showing.kind !== 'system' && here.polarity === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => save(inPolarity(option.id))}
                  title={option.mood}
                  className={cn(
                    // ui-ok: hand-rolled-box -- a segmented choice needs its outline to read as pressable; the chosen one drops it for the tint.
                    'press flex-1 rounded-control border px-2 py-1.5 text-small font-medium transition-colors',
                    on ? 'border-transparent bg-accent-tint text-accent' : 'border-border text-ink-muted hover:bg-sunken hover:text-ink',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <SectionLabel className="pb-1.5 pt-3">Surface</SectionLabel>

          <div role="radiogroup" aria-label="Surface" className="flex gap-1 pb-1">
            {THEME_SURFACES.map((option) => {
              const on = showing.kind !== 'system' && here.surface === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => save(inSurface(option.id))}
                  title={option.mood}
                  className={cn(
                    // ui-ok: hand-rolled-box -- a segmented choice needs its outline to read as pressable; the chosen one drops it for the tint.
                    'press flex-1 rounded-control border px-2 py-1.5 text-small font-medium transition-colors',
                    on ? 'border-transparent bg-accent-tint text-accent' : 'border-border text-ink-muted hover:bg-sunken hover:text-ink',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <SectionLabel className="pb-1.5 pt-3">Colour</SectionLabel>

          {aurora ? (
            <div className="flex flex-wrap gap-1.5 pb-2">
              {SKIES.filter(
                (option) =>
                  option[here.polarity === 'light' ? 'dawn' : 'night'] &&
                  isLandscape(option.id) === (here.surface === 'landscape'),
              ).map((option) => {
                const next = auroraFor(here.polarity, option.id);
                return (
                  <SkySwatch
                    key={option.id}
                    sky={option}
                    side={here.polarity === 'light' ? 'dawn' : 'night'}
                    label={`${option.label} - ${option.mood}`}
                    chosen={same(showing, next)}
                    onChoose={() => save(next)}
                  />
                );
              })}
            </div>
          ) : (
          <>
          <div className="flex flex-wrap gap-1.5 pb-1">
            <Swatch
              theme={inHue(null)}
              label="No colour"
              chosen={same(showing, inHue(null))}
              onChoose={save}
            />
            {COLOURWAYS.map((colour) => (
              <Swatch
                key={colour.id}
                theme={inWay(colour)}
                label={colour.label}
                chosen={same(showing, inWay(colour))}
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
          </>
          )}

          <button
            type="button"
            onClick={() => save({ kind: 'system' })}
            aria-pressed={showing.kind === 'system'}
            className={cn(
              // ui-ok: hand-rolled-box -- a segmented choice needs its outline to read as pressable; the chosen one drops it for the tint.
              'press mt-3 w-full rounded-control border px-2 py-1.5 text-small font-medium transition-colors',
              showing.kind === 'system'
                ? 'border-transparent bg-accent-tint text-accent'
                : 'border-border text-ink-muted hover:bg-sunken hover:text-ink',
            )}
          >
            Follow the system
          </button>

          <SectionLabel className="pb-1.5 pt-3">Density</SectionLabel>
          <div role="radiogroup" aria-label="Density" className="flex gap-1 pb-1">
            {DENSITIES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={density === option.id}
                onClick={() => chooseDensity(option.id)}
                className={cn(
                  // ui-ok: hand-rolled-box -- a segmented choice needs its outline to read as pressable; the chosen one drops it for the tint.
                  'press flex-1 rounded-control border px-2 py-1.5 text-small font-medium transition-colors',
                  density === option.id
                    ? 'border-transparent bg-accent-tint text-accent'
                    : 'border-border text-ink-muted hover:bg-sunken hover:text-ink',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
    </div>
  );
}

/**
 * One Solid colour, shown flat, as what it actually paints.
 *
 * Solid has no wash: a colour there turns the ground, the borders and the
 * accent to its hue and nothing else. So the chip is that, flat -- the card
 * ground of the room being edited, with a disc of the accent on it -- rather
 * than the glass rooms' multi-colour wash, which promised gradients Solid
 * never draws. "No colour" is the same picture in Paper or Ink.
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
  const { ground, accent, fill } = useMemo(() => {
    const palette = generatePalette(theme.mode, theme.hue, theme.way);
    return {
      ground: palette['--c-surface'],
      accent: palette['--c-accent-base-lit'],
      fill: palette['--c-fill-ink'],
    };
  }, [theme.mode, theme.hue, theme.way]);

  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={() => onChoose(theme)}
        aria-pressed={chosen}
        className={cn(
          // ui-ok: hand-rolled-box -- a user's colour against a like ground needs an edge, which is the case law 11 keeps the border for.
          'press flex size-8 items-center justify-center rounded-control border border-border-strong transition-transform hover:scale-105',
          chosen && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
        )}
        // ui-ok: raw-hex -- this is the generated colour itself, which is the
        // one thing on the screen that cannot be a token.
        style={{ backgroundColor: ground }}
      >
        <span
          className="flex size-4 items-center justify-center rounded-full"
          // ui-ok: raw-hex -- the generated accent, as above.
          style={{ backgroundColor: accent, color: fill }}
        >
          {chosen && <Check className="size-3" strokeWidth={1.75} aria-hidden />}
        </span>
        <span className="sr-only">{label}</span>
      </button>
    </Tooltip>
  );
}

/**
 * How loud a sky chip is, against the percentages in `--page-wash`.
 *
 * The largest of those is 34%, so 2.6 lands just under the 100% at which a
 * pool stops being a wash and becomes a flat fill.
 */
const CHIP_LIFT = 2.6;

/**
 * A sky, drawn as the sky it paints: its own bench with its four pools on it,
 * or its painted scene shrunk.
 *
 * `.wash-chip` draws the pools, with the side for the polarity
 * the person is in, so a Dawn swatch is the pale version they will get.
 */
function SkySwatch({
  sky,
  side,
  label,
  chosen,
  onChoose,
}: {
  sky: Sky;
  side: 'night' | 'dawn';
  label: string;
  chosen: boolean;
  onChoose: () => void;
}) {
  const style = useMemo(() => {
    // The picker only offers a sky in a polarity it has, so this side exists.
    const colours = sky[side]!;
    // A painted scene shows the scene itself, shrunk.
    if (colours.art) {
      return {
        backgroundColor: colours.bench,
        backgroundImage: `url("${colours.art}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center bottom',
      } as React.CSSProperties;
    }
    return {
      backgroundColor: colours.bench,
      [WASH_LIFT]: String(CHIP_LIFT),
      ...Object.fromEntries(
        Object.entries(POOL_TOKENS).map(([slot, token]) => [
          token,
          colours.pools[slot as keyof typeof colours.pools],
        ]),
      ),
    } as React.CSSProperties;
  }, [sky, side]);

  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onChoose}
        aria-pressed={chosen}
        className={cn(
          // ui-ok: hand-rolled-box -- a user's colour against a like ground needs an edge, which is the case law 11 keeps the border for.
          'press wash-chip flex size-8 items-center justify-center rounded-control border border-border-strong transition-transform hover:scale-105',
          chosen && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
        )}
        // ui-ok: raw-hex -- this is the sky itself, which is the one thing on the
        // screen that cannot be a token.
        style={style}
      >
        {chosen && <Check className="size-3.5 text-surface mix-blend-difference" strokeWidth={1.75} aria-hidden />}
        <span className="sr-only">{label}</span>
      </button>
    </Tooltip>
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

  // Flush with the swatches and buttons around it, and pulled up into the
  // press box's empty lower half so the gap under the gradient is the
  // panel's usual one rather than a band twice its size.
  return (
    <div className="-mb-2 pt-1.5">
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
        // ui-ok: fixed-control-height -- the 44px box is the phone press target; the gradient is drawn 1rem tall in its middle, so
        // the strip reads as before without a frame.
        className="h-11 w-full cursor-pointer appearance-none bg-[length:100%_1rem] bg-center bg-no-repeat [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-surface [&::-moz-range-thumb]:bg-transparent [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface [&::-webkit-slider-thumb]:bg-transparent"
        // The gradient is generated, so it cannot be a class: it is a hundred
        // and eighty degrees of this app's own accent, not a stock rainbow.
        style={{ backgroundImage: track }}
      />
    </div>
  );
}
