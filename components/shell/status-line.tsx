'use client';

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ActivityLine } from '@/lib/shell/activity';
import { mainCheckTitle, mainDot, type MainCheck, type MainDot } from '@/lib/plan/main-check';

/**
 * The status line.
 *
 * One line, at the bottom, in machine voice. It says what the system did while
 * nobody was looking, which in an app built around background ingestion is
 * most of what happens.
 *
 * It is the cheapest rung of the attention ladder: it moves nothing, blocks
 * nothing, and is not addressed to you. Anything that genuinely needs you is
 * further up -- a nav count, or a banner.
 *
 * It fades back after a few seconds rather than staying at full strength. A
 * line that is always as loud as the page becomes a line nobody reads, and
 * this one is meant to be glanced at rather than watched.
 *
 * The dot at the right is the one thing here that is not about the last few
 * minutes of ingestion: it is whether main is green. It rides this line rather
 * than getting a place of its own because it wants exactly this rung -- glance
 * at it, never be stopped by it -- and because this line is already on every
 * page. It is read from a stored row, never from GitHub; see
 * `lib/shell/main-check.ts`.
 */
export function StatusLine({
  lines,
  main = null,
}: {
  lines: ActivityLine[];
  main?: MainCheck | null;
}) {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (lines.length === 0) return;
    const timer = window.setTimeout(() => setSettled(true), 6000);
    return () => window.clearTimeout(timer);
  }, [lines]);

  // The bar used to exist only for the activity lines, so no lines meant no
  // bar. The dot is the second reason for it to be here and it is the one that
  // matters on a quiet day -- main goes red on the nights nothing else is
  // happening -- so the line now stands for either. With neither there is
  // still nothing to draw.
  if (lines.length === 0 && !main) return null;

  return (
    <div className="pointer-events-none sticky bottom-0 z-status hidden border-t border-shell-border bg-shell/85 backdrop-blur lg:block">
      <div
        className={cn(
          'flex items-center gap-2 px-4 py-1.5 font-mono text-micro transition-opacity duration-1000 sm:px-6',
          settled ? 'text-shell-muted/70' : 'text-shell-muted',
        )}
      >
        <Activity className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          {lines.map((line) => line.text).join('  ·  ')}
        </span>
        <MainDotMark check={main} />
        <Timestamp />
      </div>
    </div>
  );
}

/**
 * The reader's own clock, ticking every half minute.
 *
 * Null until the component has mounted, deliberately. A clock rendered on the
 * server is a clock that is wrong by the time it arrives, and one rendered
 * during hydration is a mismatch warning. This is the one thing on the page
 * that has to come from the reader's own machine, and both things on this line
 * that depend on it -- what time it is, and how old the CI reading is -- take
 * it from here so they cannot disagree.
 */
function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

/** Local wall-clock time, in the reader's own format. */
function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function Timestamp() {
  const now = useNow();
  if (now === null) return null;
  return <span className="tabular shrink-0">{clock(now)}</span>;
}

/**
 * Whether main is green, as a dot.
 *
 * A dot rather than one of `lib/status-glyphs.ts`'s eleven shapes because a
 * dot is what was asked for: this is the app shell, not a dev queue, and a
 * hexagon in the corner of every page would read as a control.
 *
 * But law 4 does not let a state be a hue and nothing else, so the dot says it
 * twice. The sentence is the first channel -- `title` hands it to a mouse and
 * `aria-label` hands the same words to a screen reader, and it names the
 * commit and when it was read, which is what makes the colour worth trusting
 * rather than merely worth looking at. The halo is the second: red is the only
 * state that gets one, so the one reading that needs somebody carries a mark
 * nothing else on the line has, in greyscale as much as in colour.
 *
 * A ring rather than a border, because a rounded box with a bare `border` is
 * what `npm run check:ui` calls a hand-rolled box -- rightly, everywhere that
 * is a box. An 8px dot is not one.
 *
 * Nothing drawn here depends on the clock before mount: the stored conclusion
 * is server-rendered as it stands, and only the staleness test and the time in
 * the sentence wait for `useNow`. The dot keeps its size and its place either
 * way, so the line does not change shape on hydration.
 */
function MainDotMark({ check }: { check: MainCheck | null }) {
  const now = useNow();
  const state = mainDot(check, now);
  // The reading's own time, formatted here rather than in the pure module, and
  // only once the reader's machine is the one doing the formatting.
  const read = now === null || !check ? null : clock(new Date(check.checkedAt).getTime());
  const said = mainCheckTitle(check, now, read);

  return (
    <span
      role="img"
      aria-label={said}
      title={said}
      className={cn('pointer-events-auto size-2 shrink-0 rounded-full', DOT[state])}
    />
  );
}

/**
 * One class list per state.
 *
 * A `Record`, so a fifth state added to `MainDot` fails the typecheck here
 * instead of drawing itself as a pass. The tokens are the app's own
 * (`--c-positive`, `--c-caution`, `--c-danger`, all declared at `:root`) plus
 * the shell's muted ink for the state where nothing is known -- the shell
 * paints its own ground and names its own ink, so it is outside the page and
 * sheet scopes and reads these at their root values, which is what lets one
 * class list follow all five themes.
 *
 * `unknown` is the muted ink rather than a colour on purpose: grey is the one
 * thing on this line that is not a claim. Nothing read, a refusal from GitHub,
 * a reading gone stale and a commit nothing checked all land on it, and the
 * sentence says which.
 */
const DOT: Record<MainDot, string> = {
  passed: 'bg-positive',
  failed: 'bg-danger ring-2 ring-danger/30',
  running: 'bg-caution',
  unknown: 'bg-shell-muted',
};
