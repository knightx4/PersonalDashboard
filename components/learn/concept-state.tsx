import { AlertTriangle, BadgeCheck, CircleDashed, CircleDot, Eye, Gem } from 'lucide-react';
import { cn } from '@/lib/cn';
import { lastCheckedLine } from '@/lib/learn/graph/last-answered';
import type { Concept } from '@/lib/learn/graph/model';

/**
 * How a concept's state is said, wherever it is said.
 *
 * Six states and three ways of establishing them, kept apart on purpose:
 * "you told me you knew this" and "you answered three questions on it" are
 * different claims, and a screen that rendered them identically would be
 * overstating one of them every time. The subject page and the concept page
 * both say it, so the words live here rather than in whichever one was
 * written first.
 *
 * Three of the labels are the ladder, and they say what was shown rather than
 * grading it: picking the idea out of four is recognising it, answering a case
 * you have not seen is knowing it, and holding it against the strongest
 * objection makes it sharp.
 */

export const STATE_LABEL: Record<Concept['state'], string> = {
  recognised: 'Recognised',
  known: 'Known',
  sharp: 'Sharp',
  shaky: 'Shaky',
  misconception: 'Misconception',
  unknown: 'Not looked at',
};

export const ESTABLISHED_LABEL: Record<Concept['established'], string> = {
  tested: 'answered questions on it',
  inferred: 'inferred from something above it',
  declared: 'you said so',
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
