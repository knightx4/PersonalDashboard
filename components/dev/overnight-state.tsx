import { StateLabel, type DevTone } from '@/components/dev/state-label';
import type { OvernightStanding } from '@/lib/plan/overnight';
import type { StatusGlyph as GlyphName } from '@/lib/status-glyphs';

/**
 * What the overnight runner is doing, in the one word the app has for it.
 *
 * Two surfaces say this now -- the control on the plan page that starts and
 * holds the night, and the morning summary that reports it afterwards -- and
 * the same night described two ways on two pages is worse than either
 * description. So the word, the shape and the tone are here, once, and both
 * read them.
 *
 * The four states are `overnightStanding`'s, which is the only thing that
 * reads them off the row: a run with `running: false` and no reason is `off`
 * rather than `stopped`, and that distinction is what stops a fresh account
 * being told a night ended.
 */

/** The state's word. Local to the runner, because no dev queue has these four. */
export const OVERNIGHT_WORD: Record<OvernightStanding, string> = {
  off: 'Off',
  running: 'Running',
  // "Held" rather than "Paused", because pausing sounds like the session stops
  // too and it does not: what is building carries on to its commit.
  paused: 'Held',
  stopped: 'Stopped',
};

/** Law 4: the state is a shape as well as a colour. */
export const OVERNIGHT_GLYPH: Record<OvernightStanding, GlyphName> = {
  off: 'empty',
  running: 'three-quarters',
  paused: 'bar',
  stopped: 'check',
};

export const OVERNIGHT_TONE: Record<OvernightStanding, DevTone> = {
  off: 'ghost',
  running: 'accent',
  paused: 'caution',
  stopped: 'quiet',
};

export function OvernightState({
  standing,
  className,
}: {
  standing: OvernightStanding;
  className?: string;
}) {
  return (
    <StateLabel
      glyph={OVERNIGHT_GLYPH[standing]}
      word={OVERNIGHT_WORD[standing]}
      tone={OVERNIGHT_TONE[standing]}
      className={className}
    />
  );
}
