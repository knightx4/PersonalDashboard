import type { TeachBackState } from '@/lib/learn/feed/teach-back';

/**
 * Explain questions in Practice Flow (plan #2164.2).
 *
 * A question about one of your goals asks you to explain the idea in a few
 * sentences rather than pick from four options. The answer is marked by the
 * teach-back grader (`lib/learn/feed/mark-teach-back.ts`) for what was right
 * and what was missing, Dash asks one follow-up, and that is marked too. The
 * idea is left where a teach-back leaves it (`teachBackState`).
 *
 * The prompt is written here, with no model call: the idea's name, the three
 * things a teach-back asks for, and the idea's checks, so one answer covers
 * several sides of the idea rather than one fact about it. Multiple choice
 * stays for re-checks on ideas already settled, which are written by the
 * track pick as before.
 *
 * This file holds what needs no database: the prompt, and what the screen
 * is told after each answer.
 */

/** The most checks named in the prompt, so it stays a few sentences long. */
export const PROMPT_CHECKS = 3;

/** "Says what happens to runway." -> "says what happens to runway" */
function asClause(check: string): string {
  const trimmed = check.trim().replace(/[.;]+$/, '');
  if (!trimmed) return '';
  // An acronym or a name at the start keeps its capital.
  if (/^[A-Z]{2}/.test(trimmed)) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/** "a", "a and b", "a, b and c" */
function joined(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The question on the card: explain the idea as if to a friend, and, when
 * the idea has checks, what a full answer also does.
 */
export function explainPrompt(name: string, checks: readonly string[] = []): string {
  const idea = name.trim().replace(/[.!?]+$/, '');
  const base = `Explain this idea to a friend in a few sentences: ${idea}. Say what it means, why it holds, and give an example of your own.`;
  const clauses = checks.map(asClause).filter(Boolean).slice(0, PROMPT_CHECKS);
  if (clauses.length === 0) return base;
  return `${base} A full answer also ${joined(clauses)}.`;
}

/** The marks on one answer, as the screen shows them. Never the expected answer. */
export type ExplainMarks = {
  holds: boolean;
  right: string[];
  missing: string[];
  /** The grader's one sentence, shown when both lists are empty. */
  why: string;
};

/** What the screen holds once the explanation is marked. */
export type Explained = ExplainMarks & {
  /** Whether the explanation had an example of its own. */
  ownExample: boolean;
  /** Set when the answer was "I don't know": nothing was marked. */
  dontKnow?: boolean;
  /** The one follow-up, and its row. Unset after "I don't know". */
  followUp?: { probeId: string; question: string };
  /** Where the idea now stands. */
  state: TeachBackState;
  /** The idea as written, shown once there is nothing more to answer. */
  claim?: string;
};

/** What the screen holds once the follow-up is marked. */
export type FollowedUp = ExplainMarks & {
  state: TeachBackState;
  claim: string;
};

/** The heading over the marks on the explanation. */
export function explainedHeading(explained: Pick<Explained, 'holds' | 'dontKnow'>): string {
  if (explained.dontKnow) return 'Counted as a miss.';
  return explained.holds ? 'That holds.' : 'Not quite.';
}

/** The heading over the marks on the follow-up. */
export function followedUpHeading(followed: Pick<FollowedUp, 'holds'>): string {
  return followed.holds ? 'The follow-up holds too.' : 'The follow-up did not hold.';
}
