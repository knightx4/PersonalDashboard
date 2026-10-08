import type { MatchVerdict } from '@/lib/jobs/evidence/match-payload';

/**
 * Colour carries the verdict, so a map is readable at a glance without reading
 * every line. Gap is red on purpose: it is the answer that saves you the hour,
 * not a failure state to be softened.
 *
 * The good/middling/bad triad, not the pipeline's stage hues -- which resolve
 * to the same three values in every theme, and which law 4 gives to one stage
 * each and to nothing else. A requirement is not a stage. Every line also
 * carries a dot and a word, so the colour is what makes the gaps findable
 * rather than what says which line is which.
 */
export const VERDICT_STYLE: Record<MatchVerdict, { dot: string; label: string; text: string }> = {
  strong: { dot: 'bg-positive', label: 'Strong', text: 'text-positive' },
  partial: { dot: 'bg-caution-fill', label: 'Partial', text: 'text-caution' },
  gap: { dot: 'bg-danger', label: 'Gap', text: 'text-danger' },
};
