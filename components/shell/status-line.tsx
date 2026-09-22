'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Popover } from '@/components/ui/popover';
import { usePopover } from '@/lib/use-popover';
import type { ActivityLine } from '@/lib/shell/activity';
import type { Brief } from '@/lib/shell/brief';
import {
  deployLine,
  MAIN_DOT_MEANING,
  MAIN_DOT_ORDER,
  migrationsLine,
  mainCheckTitle,
  mainDot,
  type MainCheck,
  type MainDot,
} from '@/lib/plan/main-check';

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
 *
 * The workspace's one-line summary reads at the left of this line from lg up,
 * where the middle of the top bar used to carry it. It is the one thing here
 * about your data rather than about the system, so it stays on its own side of
 * the activity notes with a rule between them. Below lg this line is not drawn
 * and the top bar still carries the summary; see components/shell/app-shell.tsx.
 */
export function StatusLine({
  lines,
  brief = null,
  main = null,
}: {
  lines: ActivityLine[];
  /** The one thing this workspace would say if it could say only one thing. */
  brief?: Brief | null;
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
  // happening -- and the summary is the third, on a workspace where nothing has
  // happened yet at all. With none of the three there is still nothing to draw.
  if (lines.length === 0 && !main && !brief) return null;

  return (
    <div className="pointer-events-none sticky bottom-0 z-status hidden border-t border-shell-border bg-shell/85 backdrop-blur lg:block">
      <div
        className={cn(
          'flex items-center gap-2 px-4 py-1.5 font-mono text-micro transition-opacity duration-1000 sm:px-6',
          settled ? 'text-shell-muted/70' : 'text-shell-muted',
        )}
      >
        {brief && (
          <>
            <BriefMark brief={brief} />
            {lines.length > 0 && (
              <span className="h-3 w-px shrink-0 bg-shell-border" aria-hidden />
            )}
          </>
        )}
        {/* The icon marks where the activity notes start, so it is drawn only
        when there are some. Without this it sat in front of the summary and
        read as labelling it. */}
        {lines.length > 0 && (
          <Activity className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
        )}
        {/* Empty when there are no notes, and still the flexible cell: it is
        what holds the dot and the clock in the right corner. */}
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
 * The workspace's summary, on the status line.
 *
 * Capped at half the line and truncated past that, so a long summary and long
 * activity notes each keep half rather than one of them squeezing the other to
 * an ellipsis.
 *
 * The line as a whole is `pointer-events-none` -- it is read, not used, and a
 * strip across the foot of every page that swallows clicks is a strip in the
 * way. A summary that links somewhere has to take its clicks back, the same as
 * the dot above.
 *
 * No pill here. In the top bar the caution tone was a tinted chip, which is
 * the right weight in a 56px bar and too much in a line this thin; the colour
 * alone carries it, and the underline on hover says the rest is a link.
 */
function BriefMark({ brief }: { brief: Brief }) {
  const box = 'min-w-0 max-w-1/2 shrink-0 truncate';
  const tone = brief.tone === 'caution' ? 'text-caution' : undefined;

  if (!brief.href) return <span className={cn(box, tone)}>{brief.text}</span>;

  return (
    <Link
      href={brief.href}
      className={cn(
        box,
        'pointer-events-auto underline-offset-2 transition-colors hover:underline',
        tone ?? 'hover:text-shell-ink',
      )}
    >
      {brief.text}
    </Link>
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
 * twice. The sentence is the first channel -- `title` hands it to a mouse, the
 * button's own text hands the same words to a screen reader, and the panel
 * below hands them to a click. It names the commit and when it was read, which
 * is what makes the colour worth trusting rather than merely worth looking at.
 * The halo is the second: red is the only state that gets one, so the one
 * reading that needs somebody carries a mark nothing else on the line has, in
 * greyscale as much as in colour.
 *
 * A ring rather than a border, because a rounded box with a bare `border` is
 * what `npm run check:ui` calls a hand-rolled box -- rightly, everywhere that
 * is a box. An 8px dot is not one.
 *
 * Nothing drawn here depends on the clock before mount: the stored conclusion
 * is server-rendered as it stands, and only the staleness test and the time in
 * the sentence wait for `useNow`. The dot keeps its size and its place either
 * way, so the line does not change shape on hydration.
 *
 * -- Why it is a button --
 *
 * The sentence used to be reachable only by hovering, which is a mouse asking
 * a question and getting an answer at the cursor rather than at the dot. And
 * the sentence is only half of what somebody standing in front of a coloured
 * dot wants: the other half is what the colours are, which no `title` has room
 * for. Clicking opens both, above the dot, where the dot is. The `title` stays,
 * because a hover that already worked is not worth taking away.
 *
 * The button is padded to a real target and the padding is pulled back out
 * again, so the dot is still an 8px dot in the same place on the line.
 */
function MainDotMark({ check }: { check: MainCheck | null }) {
  const now = useNow();
  const state = mainDot(check, now);
  // The reading's own time, formatted here rather than in the pure module, and
  // only once the reader's machine is the one doing the formatting.
  const read = now === null || !check ? null : clock(new Date(check.checkedAt).getTime());
  const said = mainCheckTitle(check, now, read);

  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  usePopover({ open, onClose: () => setOpen(false), panelRef, triggerRef });

  return (
    <span className="pointer-events-auto relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={said}
        className="-m-1.5 flex items-center rounded-full p-1.5 transition-colors hover:bg-shell-hover"
      >
        <span className={cn('size-2 rounded-full', DOT[state])} aria-hidden />
        <span className="sr-only">{`CI on main. ${said}`}</span>
      </button>

      {open && (
        <Popover
          ref={panelRef}
          role="dialog"
          aria-label="CI on main"
          tabIndex={-1}
          anchor="trigger-above-end"
          padding="panel"
          className="w-72 font-sans"
        >
          <p className="text-ui text-ink">{said}</p>
          {/*
            Why, and where to read more. Only a red reading carries either,
            and only when the tick could read the failing jobs; the sentence
            above still stands on its own when it could not.
          */}
          {state === 'failed' && check?.reason && (
            <p className="mt-2 text-caption text-ink">{check.reason}</p>
          )}
          {state === 'failed' && check?.runUrl && (
            <a
              href={check.runUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-caption text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              Open the run on GitHub
            </a>
          )}
          {check && <Readings check={check} />}
          <ul className="mt-3 space-y-2 border-t border-border pt-3">
            {MAIN_DOT_ORDER.map((dot) => (
              <li key={dot} className="flex items-start gap-2">
                <span
                  className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT[dot])}
                  aria-hidden
                />
                {/*
                  The state being drawn right now is in full ink and the other
                  three are muted, so the legend answers "which one am I looking
                  at" without being read end to end.
                */}
                <span
                  className={cn(
                    'text-caption',
                    dot === state ? 'font-semibold text-ink' : 'text-ink-muted',
                  )}
                >
                  {MAIN_DOT_MEANING[dot]}
                </span>
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </span>
  );
}

/**
 * The deploy and migration readings, one line each, under the CI sentence.
 *
 * A line with nothing to say is left out rather than drawn as "unknown": the
 * row predates the reading, and the next tick fills it in. The deploy links to
 * Vercel's page for it when it failed, because that page has the build log.
 */
function Readings({ check }: { check: MainCheck }) {
  const deploy = deployLine(check);
  const migrations = migrationsLine(check);
  if (!deploy && !migrations) return null;
  const deployBad = check.deployState === 'failed' || check.deployState === 'missing';
  const migrationsBad = (check.unapplied?.length ?? 0) > 0;

  return (
    <dl className="mt-3 space-y-1.5 border-t border-border pt-3 text-caption">
      {deploy && (
        <div>
          <dt className="sr-only">Deploy</dt>
          <dd className={deployBad ? 'text-danger' : 'text-ink-muted'}>
            {deploy}
            {deployBad && check.deployUrl && (
              <>
                {' '}
                <a
                  href={check.deployUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-ink"
                >
                  Open the deploy
                </a>
              </>
            )}
          </dd>
        </div>
      )}
      {migrations && (
        <div>
          <dt className="sr-only">Migrations</dt>
          <dd className={cn('break-words', migrationsBad ? 'text-danger' : 'text-ink-muted')}>
            {migrations}
          </dd>
        </div>
      )}
    </dl>
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
