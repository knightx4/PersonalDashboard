import { AlertTriangle, BadgeCheck, CircleDashed, CircleDot, Eye, Gem } from 'lucide-react';
import { cn } from '@/lib/cn';
import { lastCheckedLine } from '@/lib/learn/graph/last-answered';
import type { Concept } from '@/lib/learn/graph/model';
import type { Rung } from '@/lib/learn/graph/probe-payload';

/**
 * How a concept's state is said, wherever it is said.
 *
 * The database keeps six states, and the screen says four of them. Known and
 * sharp both read "Known", since both mean the idea is settled. Recognised
 * and shaky both read "Getting there": picking the idea out of four still
 * leaves the applied case to answer, and a shaky idea has been half shown.
 * What the question was is still said by RUNG_LABEL below, so the ladder is
 * not lost, only no longer named as a state.
 *
 * How a state was reached is kept apart on purpose: "you told me you knew
 * this" and "you answered three questions on it" are different claims, and a
 * screen that rendered them identically would be overstating one of them
 * every time.
 */

export const STATE_LABEL: Record<Concept['state'], string> = {
  recognised: 'Getting there',
  known: 'Known',
  sharp: 'Known',
  shaky: 'Getting there',
  misconception: 'Mixed up',
  unknown: 'Not seen yet',
};

export const ESTABLISHED_LABEL: Record<Concept['established'], string> = {
  tested: 'answered questions on it',
  inferred: 'inferred from something above it',
  declared: 'you said so',
};

/**
 * The three rungs, said as what the question was rather than as a verb.
 *
 * The state labels above say what has been shown about a claim; these say what
 * was asked. Kept together because a page that names one usually names the
 * other, and they have to agree: picking the idea out of four is the multiple
 * choice rung and what it can establish is "recognised".
 */
export const RUNG_LABEL: Record<Rung, string> = {
  recognise: 'Multiple choice',
  apply: 'Applied case',
  defend: 'Defence',
};

export function StateMark({ concept, className }: { concept: Concept; className?: string }) {
  const shared = cn('size-4 shrink-0', className);
  switch (concept.state) {
    case 'sharp':
      return <Gem className={cn(shared, 'text-ink-muted')} strokeWidth={2} aria-hidden />;
    case 'known':
      return <BadgeCheck className={cn(shared, 'text-ink-muted')} strokeWidth={2} aria-hidden />;
    case 'recognised':
      return <Eye className={cn(shared, 'text-ink-muted')} strokeWidth={2} aria-hidden />;
    case 'misconception':
      return <AlertTriangle className={cn(shared, 'text-danger')} strokeWidth={2} aria-hidden />;
    case 'shaky':
      return <CircleDot className={cn(shared, 'text-ink-muted')} strokeWidth={2} aria-hidden />;
    default:
      return <CircleDashed className={cn(shared, 'text-ink-muted')} strokeWidth={2} aria-hidden />;
  }
}

/**
 * When this claim was last actually asked about.
 *
 * "Known" reads the same whether the question was yesterday or in March, and
 * the difference is the whole of what a re-check is for. Nothing here says
 * "never": a claim settled by inference or because you said so has no date,
 * and the line is left off rather than filled in with an absence.
 *
 * `now` is a parameter so a gallery shot and a test render the same words
 * twice; the pages leave it out and get the time the page was rendered.
 */
export function LastChecked({
  concept,
  timezone,
  now,
  className,
}: {
  concept: Concept;
  timezone: string;
  now?: Date;
  className?: string;
}) {
  const line = lastCheckedLine(concept.testedAt, now ?? new Date(), timezone);
  if (!line) return null;

  return <p className={cn('text-small text-ink-muted', className)}>{line}</p>;
}
