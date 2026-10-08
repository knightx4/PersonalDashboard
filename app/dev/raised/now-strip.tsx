import Link from 'next/link';
import { TONE_TEXT, type DevTone } from '@/components/dev/state-label';
import { cn } from '@/lib/cn';
import type { MainCheck } from '@/lib/plan/main-check';
import { overnightStanding, type OvernightRun } from '@/lib/plan/overnight';

/** One fact of the strip: a word, the tone it is said in, and the page it opens. */
type Chip = { key: string; label: string; value: string; tone: DevTone; href: string };

const RUNNER_WORD = {
  running: 'Running',
  paused: 'Held',
  stopped: 'Stopped',
  off: 'Resting',
} as const;

/** The plan runner's chip: what it is doing, and how many features it could pick up. */
function runnerChip(run: OvernightRun | null, ready: number): Chip {
  const standing = overnightStanding(run);
  return {
    key: 'plan',
    label: 'Plan',
    value: `${RUNNER_WORD[standing]} · ${ready} ready`,
    tone: standing === 'running' ? 'accent' : standing === 'stopped' ? 'caution' : 'quiet',
    href: '/dev/plan',
  };
}

/**
 * Main's chip, from the same row the status line reads. Unapplied migrations
 * count as red: the code on main is reading columns the database lacks.
 */
function mainChip(check: MainCheck | null): Chip {
  const base = { key: 'main', label: 'Main', href: check?.runUrl ?? '/dev/plan' };
  if (!check) return { ...base, value: 'Not read', tone: 'ghost' };
  if (check.unapplied && check.unapplied.length > 0) {
    const count = check.unapplied.length;
    return { ...base, value: `${count} migration${count === 1 ? '' : 's'} unapplied`, tone: 'caution' };
  }
  switch (check.conclusion) {
    case 'passed':
      return { ...base, value: 'Green', tone: 'positive' };
    case 'failed':
      return { ...base, value: 'Red', tone: 'caution' };
    case 'running':
      return { ...base, value: 'Checking', tone: 'quiet' };
    default:
      return { ...base, value: 'Not read', tone: 'ghost' };
  }
}

/**
 * The top of Home: what is running and what is waiting, one chip each, every
 * chip a link to the page that holds the detail. The first question of the
 * morning is "is anything going, and is anything broken", and it used to take
 * the whole Status card to answer. The controls are still on that card,
 * folded under this strip.
 *
 * The chips wrap rather than scroll at phone width, so all four are read
 * without a swipe.
 */
export function NowStrip({
  run,
  ready,
  openNotes,
  mainCheck,
  inbox,
}: {
  run: OvernightRun | null;
  /** Features the runner could pick up, as the runner card counts them. */
  ready: number;
  openNotes: number;
  mainCheck: MainCheck | null;
  /** Rows waiting on you, counted the way the Inbox tab's badge is. */
  inbox: number;
}) {
  const chips: Chip[] = [
    runnerChip(run, ready),
    {
      key: 'notes',
      label: 'Notes',
      value: `${openNotes} open`,
      tone: 'quiet',
      href: '/dev/bugs',
    },
    mainChip(mainCheck),
    {
      key: 'inbox',
      label: 'Inbox',
      value: inbox === 0 ? 'Clear' : `${inbox} waiting`,
      tone: inbox === 0 ? 'positive' : 'caution',
      href: '/dev/inbox',
    },
  ];

  return (
    <nav aria-label="Right now" className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={chip.href}
          className="press press-area inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-small hover:bg-sunken"
        >
          <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full bg-current', TONE_TEXT[chip.tone])} />
          <span className="font-semibold text-ink">{chip.label}</span>
          <span className={cn('tabular', chip.tone === 'quiet' ? 'text-ink-muted' : TONE_TEXT[chip.tone])}>
            {chip.value}
          </span>
        </Link>
      ))}
    </nav>
  );
}
