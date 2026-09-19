'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import {
  hueOf,
  modeOf,
  parseTheme,
  THEME_CHOICE_ATTRIBUTE,
  COLOURWAYS,
  THEME_ROOMS,
  type Theme,
} from '@/lib/theme';
import { generatePalette } from '@/lib/theme/palette';
import { FIXED_STRIP, HUE_SWEEP, PALETTE_STRIP } from './palette-tokens';

/**
 * The palette you are actually in, and what the others would be.
 *
 * There is no list of themes any more, so the page cannot print one. The strip
 * is drawn with the real utility classes, which means it is the theme rather
 * than a picture of it -- change the colour in the picker and this changes
 * under you, because it is the same tokens every other surface reads.
 *
 * The sweep and the caption need to know which colour is on, and that lives on
 * the document. They render after mount rather than on the server: the server
 * would have to guess, and a guess that has to be corrected is a flash on the
 * one page in the app that is about how things look.
 */

/** What a choice is called, in a sentence. */
function describe(theme: Theme): string {
  if (theme.kind === 'system') return 'Following the system';
  if (theme.kind === 'written') return `${theme.id[0]!.toUpperCase()}${theme.id.slice(1)}`;
  const mode = THEME_ROOMS.find((option) => option.id === theme.mode)?.label ?? theme.mode;
  if (theme.hue === null) return `${mode}, no colour`;
  const way = COLOURWAYS.find((colour) => colour.id === theme.way);
  return way ? `${mode}, ${way.label.toLowerCase()}` : `${mode}, ${theme.hue}°`;
}

export function ActivePalette() {
  /** Null until mounted, which is also what says the sweep cannot be drawn yet. */
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(parseTheme(root.getAttribute(THEME_CHOICE_ATTRIBUTE)));
    read();

    // The picker writes the choice onto the document, so watching the
    // attribute is how this follows a hover without being wired to it.
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: [THEME_CHOICE_ATTRIBUTE] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-ui font-medium text-ink">{theme ? describe(theme) : 'This theme'}</p>
        <div className="flex h-7 overflow-hidden rounded-control">
          {PALETTE_STRIP.map(([utility, token, label]) => (
            <span key={token} className={cn('flex-1', utility)} title={label} />
          ))}
        </div>
        <div className="flex h-3 overflow-hidden rounded-control">
          {FIXED_STRIP.map((utility) => (
            <span key={utility} className={cn('flex-1', utility)} />
          ))}
        </div>
        <p className="text-small text-ink-ghost">
          {PALETTE_STRIP.map(([, , label]) => label).join(' · ')} · then the six workspace hues and
          the three meanings, which no colour moves
        </p>
      </div>

      {theme && <HueSweep theme={theme} />}
    </div>
  );
}

/**
 * Every thirtieth degree of the circle, in the room you are in.
 *
 * The accent rather than the ground, for the reason the picker's swatches give:
 * the grounds are near-greys a few thousandths of chroma apart, and a row of
 * them would say nothing about what choosing a colour does. The lit accent, so
 * that the row means the same thing on Lightbox, where the bench takes the
 * colour and the sheets do not.
 */
function HueSweep({ theme }: { theme: Theme }) {
  const mode = modeOf(theme);
  const hue = hueOf(theme);

  return (
    <div className="space-y-1.5">
      <p className="text-ui font-medium text-ink">The circle, in {mode}</p>
      <div className="flex gap-1">
        {HUE_SWEEP.map((degrees) => {
          const palette = generatePalette(mode, degrees);
          const near = hue !== null && Math.abs(((hue - degrees + 540) % 360) - 180) > 165;
          return (
            <span
              key={degrees}
              title={`${degrees}°`}
              className={cn(
                'h-7 flex-1 rounded-control',
                near ? 'ring-2 ring-ink ring-offset-1 ring-offset-surface' : undefined,
              )}
              // ui-ok: raw-hex -- the generated colour itself, which is the one
              // thing on this page that cannot be a token.
              style={{ background: palette['--c-accent-base-lit'] }}
            />
          );
        })}
      </div>
      <p className="text-small text-ink-ghost">
        The app&rsquo;s accent at each hue. Every one of them clears WCAG AA against every ground,
        proved by scripts/check-contrast.ts rather than by looking at this.
      </p>
    </div>
  );
}
