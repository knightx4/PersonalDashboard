import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readTheme, THEME_SELECTORS } from '@/lib/theme/css';
import {
  gamutChroma,
  hexToOklch,
  oklchToHex,
  relativeLuminance,
  withLuminance,
} from '@/lib/theme/oklch';
import { accentHueFor, generatePalette, MEANING_FLOOR, meaningGaps } from '@/lib/theme/palette';
import {
  HUE_TOKENS,
  LIGHT_CAST,
  LIGHTBOX_HUE_TOKENS,
  REFERENCE_HUE,
  REFERENCE_PALETTES,
  WASH_TOKENS,
} from '@/lib/theme/reference';

/** A colour the reference tables are allowed to hold: flat, or flat with alpha. */
const COLOUR = /^(#[0-9a-f]{6}|rgba?\([\d.\s,/]+\))$/i;

const HEX = /^#[0-9a-f]{6}$/i;

/** The shortest way round the circle between two hues, in degrees. */
function apart(a: number, b: number): number {
  const gap = Math.abs(((a - b) % 360) + 360) % 360;
  return gap > 180 ? 360 - gap : gap;
}

/** Every fifteen degrees is twenty-four hues, which is the same sweep the contrast check walks. */
const SWEEP = Array.from({ length: 24 }, (_, step) => step * 15);

const FIXED_TOKENS = Object.keys(REFERENCE_PALETTES.paper).filter(
  (token) => !HUE_TOKENS.includes(token),
);

describe('the reference palettes', () => {
  it('say what app/globals.css says', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    for (const name of ['paper', 'ink', 'dusk', 'lightbox', 'darkroom'] as const) {
      const written = readTheme(css, THEME_SELECTORS[name]);
      const baked = REFERENCE_PALETTES[name];
      for (const token of Object.keys(baked)) {
        expect(`${name} ${token} ${baked[token]}`).toBe(`${name} ${token} ${written[token]}`);
      }
      // The other direction, so a token added to globals.css is not silently
      // missing from a generated theme.
      const colours = Object.keys(written).filter(
        (token) => token.startsWith('--c-') && COLOUR.test(written[token]),
      );
      expect(colours.sort()).toEqual(Object.keys(baked).sort());
    }
  });

  it('divide every token into one that takes the colour and one that does not', () => {
    expect(HUE_TOKENS.length + FIXED_TOKENS.length).toBe(
      Object.keys(REFERENCE_PALETTES.paper).length,
    );
    for (const token of HUE_TOKENS) {
      expect(REFERENCE_PALETTES.paper[token]).toBeDefined();
      expect(REFERENCE_PALETTES.dusk[token]).toBeDefined();
    }
  });

  it('turn only the bench on Lightbox, and nothing the sheets are made of', () => {
    // #467's answer. The sheets are lit paper laid on the bench, so they keep
    // their own colours; the four of them are written with alpha as well,
    // which is a second reason the generator must not touch them.
    for (const token of LIGHTBOX_HUE_TOKENS) {
      expect(`${token} ${REFERENCE_PALETTES.lightbox[token] !== undefined}`).toBe(`${token} true`);
    }
    for (const token of ['--c-canvas', '--c-surface', '--c-raised', '--c-sunken', '--c-ink']) {
      expect(`${token} ${LIGHTBOX_HUE_TOKENS.includes(token)}`).toBe(`${token} false`);
    }
  });
});

describe('generatePalette', () => {
  it('gives back Paper for light with no colour and Ink for dark with no colour', () => {
    expect(generatePalette('light', null)).toEqual(REFERENCE_PALETTES.paper);
    expect(generatePalette('dark', null)).toEqual(REFERENCE_PALETTES.ink);
  });

  it('gives back Dusk for dark at the hue read off its own ground', () => {
    expect(generatePalette('dark', REFERENCE_HUE.dusk)).toEqual(REFERENCE_PALETTES.dusk);
  });

  it('reflects as much light as the reference did, all the way round the circle', () => {
    // The property every contrast ratio in the app rests on, and the reason
    // the generator holds luminance rather than OKLCH lightness: both sides of
    // every pair are matched, so a generated palette measures exactly what the
    // reference it came from measured. scripts/check-contrast.ts proves the
    // consequence at these same hues; this is the cause.
    for (const mode of ['light', 'dark'] as const) {
      const reference = mode === 'light' ? LIGHT_CAST : REFERENCE_PALETTES.dusk;
      for (const hue of SWEEP) {
        const palette = generatePalette(mode, hue);
        for (const token of HUE_TOKENS) {
          const drift = Math.abs(
            relativeLuminance(palette[token]) - relativeLuminance(reference[token]),
          );
          // Rounding to eight bits a channel is what is left, and near white
          // one of those steps is worth about six thousandths of luminance --
          // which moves a contrast ratio by well under a percent. A hue that
          // could not reach the luminance in gamut would fail here.
          expect(`${mode} ${hue} ${token} ${drift < 0.008}`).toBe(`${mode} ${hue} ${token} true`);
        }
      }
    }
  });

  it('keeps a light theme measuring what Paper measures, through both turns', () => {
    // The light half takes two turns to get anywhere -- Paper to LIGHT_CAST,
    // then LIGHT_CAST to the hue you asked for -- and each one rounds to eight
    // bits at the end. So the allowance here is two of those steps rather than
    // one, and the point of the test is that the two do not compound into
    // something a reader would notice.
    for (const hue of SWEEP) {
      const palette = generatePalette('light', hue);
      for (const token of HUE_TOKENS) {
        const drift = Math.abs(
          relativeLuminance(palette[token]) - relativeLuminance(REFERENCE_PALETTES.paper[token]),
        );
        expect(`${hue} ${token} ${drift < 0.016}`).toBe(`${hue} ${token} true`);
      }
    }
  });

  it('does not move a lightness further than it has to', () => {
    // Luminance is held, so perceptual lightness gives a little where the hue
    // is weighted differently. It must stay a little: a ground that visibly
    // darkened on its way round the circle would be a different theme, not the
    // same one in another colour.
    for (const mode of ['light', 'dark'] as const) {
      const reference = mode === 'light' ? LIGHT_CAST : REFERENCE_PALETTES.dusk;
      for (const hue of SWEEP) {
        const palette = generatePalette(mode, hue);
        for (const token of HUE_TOKENS) {
          const drift = Math.abs(hexToOklch(palette[token]).l - hexToOklch(reference[token]).l);
          expect(`${mode} ${hue} ${token} ${drift < 0.06}`).toBe(`${mode} ${hue} ${token} true`);
        }
      }
    }
  });

  it('leaves the colours that carry a meaning alone', () => {
    for (const mode of ['light', 'dark'] as const) {
      const reference = REFERENCE_PALETTES[mode === 'light' ? 'paper' : 'dusk'];
      for (const hue of SWEEP) {
        const palette = generatePalette(mode, hue);
        for (const token of FIXED_TOKENS) {
          expect(`${hue} ${token} ${palette[token]}`).toBe(`${hue} ${token} ${reference[token]}`);
        }
      }
    }
  });

  it('puts a light theme\'s accent on the colour that was asked for', () => {
    // What #454 settled. Paper's page and Paper's accent sit a hundred and
    // eighty apart, so a light theme that rotated Paper as one thing would
    // answer green with a green page and magenta links.
    //
    // 165 used to be the one hue in this sweep the accent did not land on: it
    // sat inside light's green stretch and #469 had it step off by eight
    // degrees. It no longer does. Giving the page a ground of its own moved
    // REFERENCE_HUE.paper -- which is read off that ground -- a few degrees
    // warm, and at the new reference the accent generated for 165 clears the
    // saved-green by more than MEANING_FLOOR on its own. Nothing was relaxed:
    // the separation check still walks all 360 degrees and passes.
    for (const hue of SWEEP) {
      const accent = hexToOklch(generatePalette('light', hue)['--c-accent-base']);
      const landed = accentHueFor('light', hue);
      expect(`${hue} on ${apart(accent.h, landed) < 2}`).toBe(`${hue} on true`);
      expect(`${hue} asked ${landed - hue}`).toBe(`${hue} asked 0`);
    }
  });

  it('brings Paper\'s accent onto Paper\'s page hue, where it was opposite it', () => {
    const page = hexToOklch(REFERENCE_PALETTES.paper['--c-page']).h;
    expect(apart(hexToOklch(REFERENCE_PALETTES.paper['--c-accent-base']).h, page)).toBeGreaterThan(
      150,
    );
    expect(apart(hexToOklch(LIGHT_CAST['--c-accent-base']).h, page)).toBeLessThan(2);
  });

  it('keeps the accent a real colour at every hue, and no louder than Paper asked', () => {
    // Lightness is held, so a hue whose chroma does not fit sRGB at that
    // lightness gives chroma up rather than going darker -- which is the trade
    // that keeps every theme as readable as Paper. What must not happen is the
    // accent washing out to a grey, or coming back more saturated than the one
    // colour in this palette anybody chose.
    const asked = hexToOklch(REFERENCE_PALETTES.paper['--c-accent-base']).c;
    for (const hue of SWEEP) {
      const accent = hexToOklch(generatePalette('light', hue)['--c-accent-base']);
      expect(`${hue} floor ${accent.c > 0.08}`).toBe(`${hue} floor true`);
      expect(`${hue} ceiling ${accent.c <= asked + 0.002}`).toBe(`${hue} ceiling true`);
    }
  });

  it('rotates light about LIGHT_CAST, which leaves the fixed colours as Paper wrote them', () => {
    for (const token of FIXED_TOKENS) {
      expect(`${token} ${LIGHT_CAST[token]}`).toBe(`${token} ${REFERENCE_PALETTES.paper[token]}`);
    }
    expect(generatePalette('light', REFERENCE_HUE.paper)).toEqual(LIGHT_CAST);
  });

  it('gives a light theme enough colour to see, at the luminance Paper wrote', () => {
    // #456: Paper's neutrals are near-greys between 0.004 and 0.013 chroma, so
    // a chosen colour reached the links and almost nothing else. They now
    // carry about what Dusk's neutrals carry, which is what dark has had all
    // along. Near white there is less room than that -- a card at pure white
    // reflects everything and cannot be any colour at all -- so what is
    // checked here is the surfaces with room in them.
    // Two floors, because the room a token has depends on how light it is.
    // Borders and text sit far enough down the scale to take the whole lift at
    // every hue; a well and the sidebar are a few per cent off white, where the
    // warm hues run out of sRGB around 0.021.
    const floors: Record<string, number> = {
      '--c-border': 0.035,
      '--c-border-strong': 0.035,
      '--c-border-control': 0.035,
      '--c-ink-muted': 0.035,
      '--c-ink-ghost': 0.035,
      '--c-sunken': 0.021,
      '--c-shell': 0.018,
    };
    for (const hue of SWEEP) {
      const palette = generatePalette('light', hue);
      for (const [token, floor] of Object.entries(floors)) {
        const got = hexToOklch(palette[token]).c;
        const paper = hexToOklch(REFERENCE_PALETTES.paper[token]).c;
        expect(`${hue} ${token} ${got >= floor}`).toBe(`${hue} ${token} true`);
        expect(`${hue} ${token} louder ${got > paper * 2}`).toBe(`${hue} ${token} louder true`);
      }
    }
  });

  it('leaves light with no colour exactly as pale as Paper is', () => {
    // The lift belongs to the cast palette, not to Paper. Light with no colour
    // is the theme the app shipped with, down to the byte.
    expect(generatePalette('light', null)).toEqual(REFERENCE_PALETTES.paper);
  });

  it('reads a hue outside 0-360 as the same place on the circle', () => {
    expect(generatePalette('dark', 40)).toEqual(generatePalette('dark', 400));
    expect(generatePalette('dark', 40)).toEqual(generatePalette('dark', -320));
  });
});

describe('generatePalette on Lightbox', () => {
  /** The bench tokens that are flat hex, which is all of them but the outline. */
  /*
   * The bench tokens that are held to the light they were written at.
   *
   * Everything on the bench except the wash's pools. A token here either
   * carries text or sits behind it, so holding its luminance is what makes a
   * generated room exactly as readable as the written one. The pools carry
   * nothing and are deliberately allowed to spend more light than they were
   * written with -- that is what takes the brown out of a warm room -- so they
   * are held to a budget instead, two tests below.
   */
  const BENCH = LIGHTBOX_HUE_TOKENS.filter(
    (token) => HEX.test(REFERENCE_PALETTES.lightbox[token]) && !WASH_TOKENS.includes(token),
  );

  it('gives back Lightbox with no colour, and at the hue read off its bench', () => {
    expect(generatePalette('lightbox', null)).toEqual(REFERENCE_PALETTES.lightbox);
    expect(generatePalette('lightbox', REFERENCE_HUE.lightbox)).toEqual(
      REFERENCE_PALETTES.lightbox,
    );
  });

  it('puts the bench on the colour that was asked for', () => {
    // Within four degrees rather than within two, which is what eight bits a
    // channel is worth at the bench's chroma: it carries 0.029 where a light
    // theme's accent carries 0.15, and the fewer steps a colour has to round
    // between, the further one of them moves the hue.
    for (const hue of SWEEP) {
      const bench = hexToOklch(generatePalette('lightbox', hue)['--c-page']);
      expect(`${hue} ${apart(bench.h, hue) < 4}`).toBe(`${hue} true`);
    }
  });

  it('reflects as much light as Lightbox did, all the way round the circle', () => {
    for (const hue of SWEEP) {
      const palette = generatePalette('lightbox', hue);
      for (const token of BENCH) {
        const drift = Math.abs(
          relativeLuminance(palette[token]) -
            relativeLuminance(REFERENCE_PALETTES.lightbox[token]),
        );
        expect(`${hue} ${token} ${drift < 0.008}`).toBe(`${hue} ${token} true`);
      }
    }
  });

  it('leaves the sheets, the workspaces and the meanings exactly as written', () => {
    for (const hue of SWEEP) {
      const palette = generatePalette('lightbox', hue);
      for (const token of Object.keys(REFERENCE_PALETTES.lightbox)) {
        if (LIGHTBOX_HUE_TOKENS.includes(token)) continue;
        expect(`${hue} ${token} ${palette[token]}`).toBe(
          `${hue} ${token} ${REFERENCE_PALETTES.lightbox[token]}`,
        );
      }
    }
  });

  it('turns the sheet outline with the bench and keeps it translucent', () => {
    // The outline is the line where a sheet ends and the bench begins, written
    // as the bench's own colour at 42%. Left behind it would draw a blue edge
    // round every card in a green room.
    for (const hue of SWEEP) {
      const outline = generatePalette('lightbox', hue)['--c-sheet-outline'];
      const parts = outline.match(/^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/);
      expect(`${hue} ${outline}`).toBe(`${hue} ${parts ? outline : 'unreadable'}`);
      expect(`${hue} alpha ${parts![4]}`).toBe(`${hue} alpha 0.42`);

      const hex = `#${[1, 2, 3]
        .map((at) => Number(parts![at]).toString(16).padStart(2, '0'))
        .join('')}`;
      // Fifteen degrees of the bench, which is as close as a colour this dark
      // gets to anything: the outline sits around 8% lightness, where a single
      // step of one channel is several degrees of hue. What the test is for is
      // that it moved at all.
      const bench = hexToOklch(generatePalette('lightbox', hue)['--c-page']);
      expect(`${hue} ${apart(hexToOklch(hex).h, bench.h) < 15}`).toBe(`${hue} true`);
    }
  });
});

describe('oklch', () => {
  it('round-trips every written colour without moving it', () => {
    for (const palette of Object.values(REFERENCE_PALETTES)) {
      for (const [token, value] of Object.entries(palette)) {
        // Lightbox writes its sheets with alpha, and a colour with alpha is not
        // one the generator reads at all.
        if (!HEX.test(value)) continue;
        expect(`${token} ${oklchToHex(hexToOklch(value))}`).toBe(`${token} ${value}`);
      }
    }
  });

  it('gives up chroma rather than lightness when a colour will not fit in sRGB', () => {
    // A yellow that saturated does not exist in sRGB at any lightness.
    const asked = { l: 0.5, c: 0.35, h: 100 };
    const got = hexToOklch(oklchToHex(asked));
    expect(got.c).toBeLessThan(asked.c);
    expect(Math.abs(got.l - asked.l)).toBeLessThan(0.004);
  });
});

/**
 * The accent stepping off the delete red, the warning amber and the saved
 * green -- #469, measured the way #493 chose, at the floor #514 set and in the
 * direction #515 named.
 */
describe('the accent and the colours that carry a meaning', () => {
  const MODES = ['light', 'dark', 'lightbox', 'darkroom'] as const;

  /** Every hue of the circle, since the stretches that move are a few degrees wide. */
  const CIRCLE = Array.from({ length: 360 }, (_, hue) => hue);

  /** Whether the accent had to step off the colour that was asked for. */
  const moved = (mode: (typeof MODES)[number], hue: number) => accentHueFor(mode, hue) !== hue;

  /** The written palette each mode's fixed colours come from. */
  const WRITTEN_AS = {
    light: 'paper',
    dark: 'dusk',
    lightbox: 'lightbox',
    darkroom: 'darkroom',
  } as const;

  it('never lets the accent wear one of them, at any hue in any mode', () => {
    for (const mode of MODES) {
      for (const hue of CIRCLE) {
        for (const { accent, meaning, gap } of meaningGaps(generatePalette(mode, hue))) {
          expect(`${mode} ${hue} ${accent}/${meaning} ${gap >= MEANING_FLOOR}`).toBe(
            `${mode} ${hue} ${accent}/${meaning} true`,
          );
        }
      }
    }
  });

  it('moves 17 hues in light, 25 in dark and 29 in either glass room, by at most 15 degrees', () => {
    // #514's answer, and what fixes the floor at 0.03: these counts and this
    // ceiling are the option that was chosen, so a change to any number is a
    // change to the decision rather than to the code.
    //
    // Darkroom matches Lightbox exactly, which is the expected answer rather
    // than a coincidence: the two share a bench, so they share the hue their
    // accents rotate from, and the meaning colours they have to stay clear of
    // are the same three.
    const counts = { light: 17, dark: 25, lightbox: 29, darkroom: 29 };
    for (const mode of MODES) {
      const shifts = CIRCLE.map((hue) => accentHueFor(mode, hue) - hue).filter((by) => by !== 0);
      expect(`${mode} ${shifts.length}`).toBe(`${mode} ${counts[mode]}`);
      expect(`${mode} ${Math.max(...shifts.map(Math.abs)) <= 15}`).toBe(`${mode} true`);
    }
  });

  it('steps to whichever side of the stretch is nearer', () => {
    // #515. Nothing between where the accent was asked to go and where it
    // landed is out of the stretch, and neither is the same distance the other
    // way -- except where the two edges are exactly as far off as each other,
    // which goes up the circle.
    for (const mode of MODES) {
      for (const hue of CIRCLE) {
        const landed = accentHueFor(mode, hue);
        if (landed === hue) continue;
        const way = Math.sign(landed - hue);
        const by = Math.abs(landed - hue);
        for (let step = 1; step < by; step += 1) {
          expect(`${mode} ${hue} +${step} ${moved(mode, hue + way * step)}`).toBe(
            `${mode} ${hue} +${step} true`,
          );
          expect(`${mode} ${hue} -${step} ${moved(mode, hue - way * step)}`).toBe(
            `${mode} ${hue} -${step} true`,
          );
        }
        if (!moved(mode, hue - way * by)) {
          expect(`${mode} ${hue} tie ${way}`).toBe(`${mode} ${hue} tie 1`);
        }
      }
    }
  });

  it('moves the accent and nothing else', () => {
    // #469 settled that the accent is what gives way, so the page, the panels
    // and the borders still land on the colour that was asked for and the
    // three meaning colours stay as they were written.
    for (const mode of MODES) {
      for (const hue of CIRCLE) {
        if (!moved(mode, hue)) continue;
        const palette = generatePalette(mode, hue);
        const ground = hexToOklch(palette['--c-page']);
        expect(`${mode} ${hue} ground ${apart(ground.h, hue) < 4}`).toBe(
          `${mode} ${hue} ground true`,
        );
        const written = REFERENCE_PALETTES[WRITTEN_AS[mode]];
        for (const token of ['--c-danger', '--c-caution', '--c-positive']) {
          expect(`${mode} ${hue} ${token} ${palette[token]}`).toBe(
            `${mode} ${hue} ${token} ${written[token]}`,
          );
        }
      }
    }
  });

  it("lifts a turned pool towards its own hue's cusp, so a warm room is not brown", () => {
    // The defect this fixes: every `--c-*` token is rotated at the light it was
    // reflecting, which is right for anything carrying text and wrong for the
    // bench's pools. A blue throws about a tenth of the light a screen can; a
    // yellow held down to a tenth is olive, because that is what a dark yellow
    // is. Two screenshots of an orange room and a gold one, both mud, are what
    // started this.
    //
    // So a pool's lightness follows where its new hue actually peaks. The test
    // is against the rule it replaced -- the same rotation with the luminance
    // held -- and only in the half of the circle where the two differ: a hue
    // whose cusp sits near blue's has nothing to lift.
    for (const hue of [25, 45, 65, 95, 125]) {
      const palette = generatePalette('darkroom', hue);
      for (const token of WASH_TOKENS) {
        const written = REFERENCE_PALETTES.darkroom[token];
        const from = hexToOklch(written);
        const turned = hexToOklch(palette[token]);
        const held = hexToOklch(
          withLuminance({ ...from, h: from.h + hue - REFERENCE_HUE.darkroom }, relativeLuminance(written)),
        );
        // Chroma rather than lightness, because that is the part that holds for
        // every pool at every warm hue. Most of them come back lighter too, but
        // not all: a hue whose cusp sits about where blue's does -- red, for the
        // darkest pool of the four -- has nowhere to lift to, and buys its way
        // out of the mud on colour alone.
        expect(`${hue} ${token} ${turned.c > held.c}`).toBe(`${hue} ${token} true`);
      }
    }
  });

  it('spends no more than a third again the light the written pool threw', () => {
    // The one thing in the wash that can cost readability. The bench carries
    // the sidebar's text, a sheet is a fifth bench, and every layer of the wash
    // only adds light -- so a pool that brightens without limit closes the gap
    // between the bench and the pale ink on it. Measured on the rendered field,
    // unbounded lifting nearly trebles the light at its brightest point and
    // takes eighteen more pairs under 4.5:1; a third again costs none of them.
    for (const mode of ['lightbox', 'darkroom'] as const) {
      for (const hue of SWEEP) {
        const palette = generatePalette(mode, hue);
        for (const token of WASH_TOKENS) {
          const budget = relativeLuminance(REFERENCE_PALETTES[mode][token]) * 1.3;
          const spent = relativeLuminance(palette[token]);
          expect(`${mode} ${hue} ${token} ${spent <= budget + 1e-6}`).toBe(
            `${mode} ${hue} ${token} true`,
          );
        }
      }
    }
  });

  it('leaves a pool alone when the colour asked for is the one it was written at', () => {
    // The wheel has to be smooth. Lifting is a move from one hue's cusp to
    // another's, so a hue that does not move must not lift -- otherwise the
    // palette either side of the written hue is not the palette written there.
    for (const mode of ['lightbox', 'darkroom'] as const) {
      const palette = generatePalette(mode, REFERENCE_HUE[mode]);
      for (const token of WASH_TOKENS) {
        expect(`${mode} ${token} ${palette[token]}`).toBe(
          `${mode} ${token} ${REFERENCE_PALETTES[mode][token]}`,
        );
      }
    }
  });

  it('keeps every pool a colour rather than a grey, all the way round', () => {
    // Chroma sits on the gamut edge at whatever lightness the lift lands on,
    // which is the other half of the fix: holding the chroma number reads as
    // vivid at blue, where sRGB is generous, and as dust at gold, where it is
    // not. A pool is seen through a 26-to-34 percent mix, so what reaches the
    // glass is a third of this.
    for (const mode of ['lightbox', 'darkroom'] as const) {
      for (const hue of SWEEP) {
        const palette = generatePalette(mode, hue);
        for (const token of WASH_TOKENS) {
          const pool = hexToOklch(palette[token]);
          expect(`${mode} ${hue} ${token} ${pool.c > 0.05}`).toBe(`${mode} ${hue} ${token} true`);
          // On the edge at its own lightness, not merely inside it. Measured at
          // the pool's exact hue: `cuspOf` answers by whole degree, which is as
          // fine as choosing a lightness needs and a hair coarser than checking
          // a chroma against the boundary.
          const edge = gamutChroma(pool.l, pool.h);
          expect(`${mode} ${hue} ${token} edge ${Math.abs(pool.c - edge) < 0.004}`).toBe(
            `${mode} ${hue} ${token} edge true`,
          );
        }
      }
    }
  });

});
