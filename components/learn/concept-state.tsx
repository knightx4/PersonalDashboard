import { AlertTriangle, BadgeCheck, CircleDashed, CircleDot } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Concept } from '@/lib/learn/graph/model';

/**
 * How a concept's state is said, wherever it is said.
 *
 * Four states and three ways of establishing them, kept apart on purpose:
 * "you told me you knew this" and "you answered three questions on it" are
 * different claims, and a screen that rendered them identically would be
 * overstating one of them every time. The subject page and the concept page
 * both say it, so the words live here rather than in whichever one was
 * written first.
 */

export const STATE_LABEL: Record<Concept['state'], string> = {
  known: 'Known',
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
    case 'known':
      return <BadgeCheck className={cn(shared, 'text-ink-muted')} strokeWidth={2} aria-hidden />;
    case 'misconception':
      return <AlertTriangle className={cn(shared, 'text-danger')} strokeWidth={2} aria-hidden />;
    case 'shaky':
      return <CircleDot className={cn(shared, 'text-ink-muted')} strokeWidth={2} aria-hidden />;
    default:
      return <CircleDashed className={cn(shared, 'text-ink-muted')} strokeWidth={2} aria-hidden />;
  }
}
