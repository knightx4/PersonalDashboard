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
  notes: string;
}

export type InterviewSection<T extends GroupableInterview> =
  | { kind: 'group'; group: InterviewGroup; interviews: T[] }
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
 * The tab's reading order: every interview exactly once, the ones in a round
 * gathered at the position of the first of them, and rounds with nothing in
 * them yet after all of it.
 *
 * Empty rounds are listed because a round is now made before anything is
 * booked into it -- "there will be a technical round, times to follow" -- and
 * one that did not render would be a round the user made and cannot see, let
 * alone add to. They go last for want of a position: they have no interview to
 * sort by, and putting them among the booked ones would move as things are
 * added.
 *
 * A group_id pointing at a group that is not on the page cannot silently
 * swallow an interview -- it renders on its own instead. That is a state the
 * database allows only briefly, and an interview that vanishes is much worse
 * than one shown outside its round.
 */
export function sectionInterviews<T extends GroupableInterview>(
  interviews: readonly T[],
  groups: readonly InterviewGroup[],
): Array<InterviewSection<T>> {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const sections: Array<InterviewSection<T>> = [];
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
    (sections[at] as { kind: 'group'; group: InterviewGroup; interviews: T[] }).interviews.push(
      interview,
    );
  }

  for (const group of groups) {
    if (indexOfGroup.has(group.id)) continue;
    sections.push({ kind: 'group', group, interviews: [] });
  }

  return sections;
}

/**
 * The days worth offering to group: two or more ungrouped rounds on one date.
 *
 * Offered rather than done automatically. Two screens on the same Tuesday for
 * two different reasons are not a superday, and the app does not know which
 * this is -- but it does know when the question is worth asking, and asking it
 * only then keeps the button off every ordinary round.
 */
export function groupableDays<T extends GroupableInterview>(
  interviews: readonly T[],
  timezone: string,
): Array<{ day: string; interviewIds: string[] }> {
  const byDay = new Map<string, string[]>();

  for (const interview of interviews) {
    if (interview.groupId) continue;
    if (!interview.scheduledAt) continue;
    const day = dayIn(interview.scheduledAt, timezone);
    byDay.set(day, [...(byDay.get(day) ?? []), interview.id]);
  }

  return [...byDay.entries()]
    .filter(([, ids]) => ids.length > 1)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, interviewIds]) => ({ day, interviewIds }));
}
