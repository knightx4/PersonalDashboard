/**
 * Rounds that are really one occasion.
 *
 * A superday is four conversations on an afternoon. Each has its own
 * interviewer, its own hour and its own notes, so each stays its own row --
 * but read as four unrelated rounds it loses the thing that made it one day,
 * and there is nowhere to write how the day went as a whole.
 *
 * PURE, and separated from the panel for the usual reason: what belongs
 * together is a rule worth testing, and a component that reads the clock and
 * the timezone itself cannot be asked "is this one day or two".
 */

export interface GroupableInterview {
  id: string;
  scheduledAt: string | null;
  groupId: string | null;
}

export interface InterviewGroup {
  id: string;
  label: string | null;
  /** Which round of the process this is. Null until it is given one. */
  roundNumber?: number | null;
  notes: string;
}

export type InterviewSection<T extends GroupableInterview, G extends InterviewGroup = InterviewGroup> =
  | { kind: 'group'; group: G; interviews: T[] }
  | { kind: 'single'; interview: T };

/** The calendar day an instant falls on, in the reader's zone. */
export function dayIn(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/**
 * The tab's reading order: every interview exactly once, inside its round,
 * with the rounds in the order they happen -- first round first.
 *
 * The round number is the order, because it is the thing that says which round
 * is first. It is not the arrival order and it is not the calendar: a first
 * round can be rescheduled to after a second, and the process still went
 * screen, then technical.
 *
 * A round with no number yet has not been placed in the process, so it sorts
 * after the ones that have rather than ahead of round 1 -- the same reasoning
 * as before, applied to the number instead of to emptiness. Ties keep the
 * order the caller gave, which is oldest first.
 *
 * A group_id pointing at a group that is not on the page cannot silently
 * swallow an interview -- it renders on its own, at the end. That is a state
 * the database allows only briefly, and an interview that vanishes is much
 * worse than one shown outside its round.
 */
export function sectionInterviews<T extends GroupableInterview, G extends InterviewGroup>(
  interviews: readonly T[],
  groups: readonly G[],
): Array<InterviewSection<T, G>> {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const sections: Array<InterviewSection<T, G>> = [];
  const indexOfGroup = new Map<string, number>();

  for (const interview of interviews) {
    const group = interview.groupId ? byId.get(interview.groupId) : undefined;
    if (!group) {
      sections.push({ kind: 'single', interview });
      continue;
    }

    const at = indexOfGroup.get(group.id);
    if (at === undefined) {
      indexOfGroup.set(group.id, sections.length);
      sections.push({ kind: 'group', group, interviews: [interview] });
      continue;
    }
    (sections[at] as { kind: 'group'; group: G; interviews: T[] }).interviews.push(interview);
  }

  for (const group of groups) {
    if (indexOfGroup.has(group.id)) continue;
    sections.push({ kind: 'group', group, interviews: [] });
  }

  // Stable, so rounds sharing a number -- or sharing the lack of one -- keep
  // the order they were loaded in.
  return sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => sortKey(a) - sortKey(b) || a.index - b.index)
    .map((entry) => entry.section);
}

/** Where a section sits: by round number, then everything unplaced after it. */
function sortKey<T extends GroupableInterview, G extends InterviewGroup>(entry: {
  section: InterviewSection<T, G>;
}): number {
  if (entry.section.kind !== 'group') return Number.MAX_SAFE_INTEGER;
  return entry.section.group.roundNumber ?? Number.MAX_SAFE_INTEGER - 1;
}

/**
 * The days worth offering to gather: one date holding interviews that sit in
 * two or more different rounds, none of which anyone has built up.
 *
 * "Ungrouped" is no longer a state anything can be in -- every interview is
 * inside a round. What is still true, and still worth asking about, is the
 * shape this has always been for: four invitations for one afternoon, each
 * arriving separately and each getting a round of its own, when they are one
 * occasion.
 *
 * A round already holding more than one interview is left strictly alone.
 * Somebody put those together on purpose, and dissolving that to build a
 * different grouping would undo a decision rather than offer one.
 *
 * Offered rather than done automatically, for the reason it always was. Two
 * screens on the same Tuesday for two different reasons are not a superday,
 * and the app does not know which this is -- but it does know when the
 * question is worth asking, and asking it only then keeps the button off every
 * ordinary round.
 */
export function groupableDays<T extends GroupableInterview>(
  interviews: readonly T[],
  timezone: string,
): Array<{ day: string; interviewIds: string[] }> {
  // A round holding one interview is a round nobody has deliberately built.
  const sizeOfRound = new Map<string, number>();
  for (const interview of interviews) {
    if (!interview.groupId) continue;
    sizeOfRound.set(interview.groupId, (sizeOfRound.get(interview.groupId) ?? 0) + 1);
  }

  const byDay = new Map<string, Array<{ id: string; round: string | null }>>();

  for (const interview of interviews) {
    if (!interview.scheduledAt) continue;
    if (interview.groupId && (sizeOfRound.get(interview.groupId) ?? 0) > 1) continue;
    const day = dayIn(interview.scheduledAt, timezone);
    byDay.set(day, [...(byDay.get(day) ?? []), { id: interview.id, round: interview.groupId }]);
  }

  return [...byDay.entries()]
    .filter(([, onDay]) => {
      if (onDay.length < 2) return false;
      // Two interviews already in one round are not two rounds to gather.
      const rounds = new Set(onDay.map((entry) => entry.round ?? `loose:${entry.id}`));
      return rounds.size > 1;
    })
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, onDay]) => ({ day, interviewIds: onDay.map((entry) => entry.id) }));
}

/**
 * One row per round, for the lists that are about rounds rather than about
 * interviews.
 *
 * This week and the Interviews table both answer "what is coming up", and a
 * superday answered four times over is one occasion pretending to be four.
 * The role's own tab still lists every interview -- that is the page where the
 * individual conversation, its interviewer and its notes are the subject.
 *
 * The order is the caller's, taken from where each round is first seen. So a
 * list sorted by date stays sorted by date, and the round sits where its
 * earliest interview sat.
 *
 * A round whose group is not among `groups` still gets a row of its own rather
 * than being dropped: an interview that vanishes from a list of what is coming
 * up is much worse than one shown outside its round.
 */
export interface RoundRow<T extends GroupableInterview, G extends InterviewGroup> {
  /** The round, where the group is known; null for one standing on its own. */
  group: G | null;
  /** Its interviews, in the order they were given. */
  interviews: T[];
  /** The one a link to this round should land on: the first of them. */
  lead: T;
}

export function roundsOf<T extends GroupableInterview, G extends InterviewGroup>(
  interviews: readonly T[],
  groups: readonly G[],
): Array<RoundRow<T, G>> {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const rows: Array<RoundRow<T, G>> = [];
  const indexOfGroup = new Map<string, number>();

  for (const interview of interviews) {
    const group = interview.groupId ? byId.get(interview.groupId) : undefined;
    if (!group) {
      rows.push({ group: null, interviews: [interview], lead: interview });
      continue;
    }

    const at = indexOfGroup.get(group.id);
    if (at === undefined) {
      indexOfGroup.set(group.id, rows.length);
      rows.push({ group, interviews: [interview], lead: interview });
      continue;
    }
    rows[at].interviews.push(interview);
  }

  return rows;
}

/**
 * What round this is, in words.
 *
 * The number belongs to the round, and a round can have been given a name
 * instead of, or as well as, a number -- "Final round" says more than "3". A
 * round with neither is one nobody has placed yet, which is null rather than
 * an invented number; the caller says how it wants to draw a blank.
 */
export function roundLabel(
  group: { roundNumber?: number | null; label: string | null } | null,
): string | null {
  if (!group) return null;
  const number = group.roundNumber ?? null;
  if (group.label && number !== null) return `${number} · ${group.label}`;
  if (group.label) return group.label;
  if (number !== null) return `Round ${number}`;
  return null;
}

/**
 * The quiet line beside a round: what it is, and what is in it.
 *
 * The rule lives here rather than in one list, because every list that shows
 * rounds instead of interviews needs the same one and they were not agreeing:
 * this week's list said "In person Final Round · 4 interviews" while the
 * to-do agenda printed the same afternoon four times over as four identical
 * "Recruiter screen · 30 min" rows.
 *
 * A round is usually named after the kind of thing in it, so printing both
 * said "Technical · Technical" more often than not. The kind earns its place
 * only where the round has no name, or is called something else.
 *
 * The duration belongs to one conversation, so it is said only when the round
 * is one conversation. How long a superday runs is not the sum of its parts,
 * and adding them up would be inventing a number.
 */
export function roundDetail(
  round: string | null,
  kindLabel: string,
  count: number,
  durationMinutes: number | null,
): string {
  return [
    round,
    count > 1
      ? `${count} interviews`
      : round?.toLowerCase().includes(kindLabel.toLowerCase())
        ? null
        : kindLabel,
    count === 1 && durationMinutes ? `${durationMinutes} min` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
