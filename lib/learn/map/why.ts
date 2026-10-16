import { whenDate } from '@/lib/core/when';
import { halvesOn, isUntested, stateSetAt, strength, type StrengthInput } from '@/lib/learn/strength';
import type { SkyTerritory, TerritoryStanding } from './place-graph';

/**
 * Why a star is lit, in words (plan #2187.5). Pure, so the sentences the rail
 * shows can be tested. Two kinds of star have a reason: an idea, lit by the
 * answers to questions about it, and a goal's topic, whose level is held by
 * an answer, by inference from one, or by your word.
 */

const date = (at: Date | string) => whenDate(at, { timeZone: 'UTC' });

/** What holds a topic's highest level, with the day. */
export function standingText(standing: TerritoryStanding): string {
  const day = date(standing.since);
  switch (standing.how) {
    case 'tested':
      return `Level ${standing.level} is held by an answer you gave on ${day}.`;
    case 'declared':
      return `You said you know it to level ${standing.level} on ${day}. No question has confirmed it.`;
    case 'inferred':
      return standing.via
        ? `Level ${standing.level} is held by inference. Your answer on ${day} at level ${standing.via.level} of ${standing.via.topicName} needs it.`
        : `Level ${standing.level} is held by inference from an answer you gave on ${day}.`;
  }
}

/** The label over the quote: the words of the answer, or of the answer that implies the level. */
export function quoteLabel(standing: TerritoryStanding): string {
  return standing.how === 'inferred' ? 'The words that showed it' : 'Your words';
}

/** When a held topic is next asked about again. */
export function dueText(standing: TerritoryStanding, asOf: Date): string {
  const due = new Date(standing.dueOn);
  return due.getTime() > asOf.getTime()
    ? `Falls due a re-check on ${date(due)}.`
    : `Due a re-check since ${date(due)}.`;
}

/** What an idea's own state says about why it is or is not bright. */
export type AnswerLine = { line: string; fades: string | null };

export function answerLine(row: StrengthInput | null, asOf: Date): AnswerLine | null {
  if (!row || row.state === 'unknown') return null;
  const set = stateSetAt(row);
  const day = set ? date(set) : null;
  if (row.state === 'misconception') {
    return { line: day ? `A question on ${day} showed it held wrongly.` : 'A question showed it held wrongly.', fades: null };
  }
  if (!isUntested(row)) {
    const percent = Math.round(strength(row, asOf) * 100);
    const halves = halvesOn(row, asOf);
    return {
      line: `${day ? `You answered a question about it on ${day}` : 'You answered a question about it'}. It reads ${percent}% today.`,
      fades: halves ? `Its strength halves next on ${date(halves)}.` : null,
    };
  }
  if (row.established === 'declared') {
    return {
      line: `${day ? `You said you know it on ${day}` : 'You said you know it'}. No question has confirmed it, so it does not shine as tested.`,
      fades: null,
    };
  }
  return { line: 'Taken from an idea above it. No question has been asked about it, so it does not shine as tested.', fades: null };
}

export type Neighbour = { name: string; level: number; at: number };

/**
 * What a topic of a territory needs and what needs it, read from the links
 * between cells: one entry per pair of topics, at the lowest level that binds.
 * `level` is the level of this topic and `at` the level of the other.
 */
export function requirementsOf(
  territory: SkyTerritory,
  topicId: string,
): { needs: Neighbour[]; neededBy: Neighbour[] } {
  const name = new Map(territory.topics.map((topic) => [topic.id, topic.name]));
  const needs = new Map<string, Neighbour>();
  const neededBy = new Map<string, Neighbour>();
  for (const link of territory.links) {
    if (link.requiringTopicId === link.requiredTopicId) continue;
    if (link.requiringTopicId === topicId) {
      const seen = needs.get(link.requiredTopicId);
      if (!seen || link.requiringLevel < seen.level) {
        needs.set(link.requiredTopicId, {
          name: name.get(link.requiredTopicId) ?? 'Another topic',
          level: link.requiringLevel,
          at: link.requiredLevel,
        });
      }
    }
    if (link.requiredTopicId === topicId) {
      const seen = neededBy.get(link.requiringTopicId);
      if (!seen || link.requiredLevel < seen.level) {
        neededBy.set(link.requiringTopicId, {
          name: name.get(link.requiringTopicId) ?? 'Another topic',
          level: link.requiredLevel,
          at: link.requiringLevel,
        });
      }
    }
  }
  const order = (a: Neighbour, b: Neighbour) => a.level - b.level || a.name.localeCompare(b.name);
  return { needs: [...needs.values()].sort(order), neededBy: [...neededBy.values()].sort(order) };
}
