/**
 * The morning run's repeats, 25 to 29 September 2026, as they were filed.
 *
 * Feature #1220 was shaped from these. The run filed the same two
 * observations five times, and by 29 September every plan row they named had
 * closed. Tests read them from here so each step under #1220 is checked
 * against what actually happened rather than against a case written to pass:
 * #1222 (settled rows), #1223 (reworded duplicates), #1224 (stale blocks).
 *
 * Ids are the first eight characters of the live rows. Every one was filed by
 * the run itself: source 'claude', no workspace, no step it came from.
 */

export type RepeatIdea = { id: string; createdAt: string; body: string };

export const MORNING_REPEATS: readonly RepeatIdea[] = [
  {
    id: 'b26258a6',
    createdAt: '2026-09-25T12:34:05Z',
    body:
      'Three open questions on how information steps should work (#988, #992, #1022)\n\n' +
      'They are all answered now and shipped: information steps close on answered questions, not filled fields; they reopen only when the rewritten answer differs; and new documents are matched by ID and update rows straight in. The design has landed, so check whether the surfaces can shift to match it.',
  },
  {
    id: '00e42a11',
    createdAt: '2026-09-25T12:34:05Z',
    body:
      'Steps blocked on code that shipped three days ago are clear to move (#985, #986, #1001)\n\n' +
      'All three have their blocking code on main. Pull them into sprint and unblock them.',
  },
  {
    id: '636a8233',
    createdAt: '2026-09-26T12:34:06Z',
    body:
      'Three questions on information steps have shipped but #1048 is still open\n\n' +
      'What closes an information step again after a changed answer reopens it — the spec looks incomplete.',
  },
  {
    id: 'd14f85e8',
    createdAt: '2026-09-26T12:34:06Z',
    body:
      'Forms and Wikipedia pulling both wait on decisions that sit in questions and foggy features\n\n' +
      'Shape what #760 needs to find and what counts as the same document kind so the blocking work gets unstuck.',
  },
  {
    id: '3a8f1038',
    createdAt: '2026-09-27T12:34:00Z',
    body:
      'Three questions on information steps have shipped but #1048 is still open\n\n' +
      "Read what closed it and update the question's note so the next one does not get blocked the same way.",
  },
  {
    id: 'd6d28a49',
    createdAt: '2026-09-29T12:34:17Z',
    body:
      'Three blocking questions on information steps are answered but the three questions on the steps are still open (#1048).\n\n' +
      'Read what closed #988, #992, #1022 and #1048 and check whether the step itself is misfiled or the question is still live.',
  },
  {
    id: '1e5937f9',
    createdAt: '2026-09-29T12:34:17Z',
    body:
      'Steps blocked on code that shipped four days ago are clear to move (#985, #986, #1001).\n\n' +
      'Their blockers are resolved; check whether they are ready or whether another blocker has appeared.',
  },
];

/**
 * The rows those ideas name, as they stood when the run fired on 29 September
 * at 12:34 UTC. Every one had closed, the latest (#986) the day before.
 */
export const ROWS_ON_29_SEPTEMBER = [
  { number: 760, kind: 'build', status: 'done', completedAt: '2026-09-27T02:57:01Z' },
  { number: 985, kind: 'build', status: 'done', completedAt: '2026-09-25T18:41:09Z' },
  { number: 986, kind: 'build', status: 'done', completedAt: '2026-09-28T16:21:33Z' },
  { number: 988, kind: 'decision', status: 'done', completedAt: '2026-09-25T00:06:40Z' },
  { number: 992, kind: 'decision', status: 'done', completedAt: '2026-09-25T01:44:26Z' },
  { number: 1001, kind: 'build', status: 'done', completedAt: '2026-09-25T17:37:02Z' },
  { number: 1022, kind: 'decision', status: 'done', completedAt: '2026-09-25T03:51:11Z' },
  { number: 1048, kind: 'decision', status: 'done', completedAt: '2026-09-26T16:55:56Z' },
] as const;

/** An idea's body split the way the run reports a suggestion: first line, then the rest. */
export function asSuggestion(idea: RepeatIdea): { title: string; detail: string | null } {
  const [title, ...rest] = idea.body.split('\n\n');
  const detail = rest.join('\n\n').trim();
  return { title: title.trim(), detail: detail.length > 0 ? detail : null };
}
