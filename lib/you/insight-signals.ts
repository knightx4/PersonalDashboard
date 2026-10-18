import { exclusionWords } from '@/lib/jobs/suggest/payload';

/**
 * The nightly insight numbers (plan #2413.7). The counting is
 * you.compute_insight_signals in the database (supabase/migrations-you/0012),
 * which writes one row a day into you.insight_signals and checks every
 * tripwire in you.insight_tripwires. This file holds what the database cannot
 * work out alone, and the kinds a tripwire may be.
 */

/** The tripwire kinds the nightly check knows, as the table's check allows. */
export const TRIPWIRE_KINDS = [
  'building_while_waiting',
  'deadline_during_building',
  'rule_broken',
  'want_recurring',
] as const;

export type TripwireKind = (typeof TRIPWIRE_KINDS)[number];

/**
 * Each excluded industry on the job profile with the words that name it, so
 * the rule "Crypto" also catches a company whose industry says web3. The
 * words come from the same list the job suggestions filter by
 * (lib/jobs/suggest/payload.ts), so the two never disagree about what a rule
 * covers.
 */
export function ruleWords(excludedIndustries: readonly string[]): Record<string, string[]> {
  const words: Record<string, string[]> = {};
  for (const rule of excludedIndustries) {
    if (!rule.trim()) continue;
    words[rule] = exclusionWords([rule]);
  }
  return words;
}
