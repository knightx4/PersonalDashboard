import { describe, expect, it, vi } from 'vitest';
import {
  HELP_NOTE_MAX,
  helpKindsLine,
  parseHelpKindFields,
  readHelpKinds,
} from './help-kinds';

const GOAL_ID = '11111111-1111-4111-8111-111111111111';

/** What the store was asked to write, and what it answers. */
const writes: { goalId: string; choices: unknown }[] = [];
let goalLive = true;

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth/server', () => ({ requireUser: async () => ({ id: 'user' }) }));
vi.mock('@/lib/goals/auth/server', () => ({ createGoalsClient: async () => ({}) }));
vi.mock('@/lib/goals/help-kinds-store', () => ({
  setGoalHelpKinds: async (_client: unknown, goalId: string, choices: unknown) => {
    writes.push({ goalId, choices });
    return goalLive;
  },
}));

const { setHelpKindsAction } = await import('@/app/goals/[goalId]/help-actions');

/** The goal page's form as the browser sends it. */
function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

function parse(data: FormData) {
  return parseHelpKindFields(
    (key) => data.getAll(key),
    (key) => data.get(key),
  );
}

describe('the city goal', () => {
  // The done-when of plan #1027.
  const city = form([
    ['goalId', GOAL_ID],
    ['kind', 'events'],
    ['note:events', 'Brooklyn, weeknights'],
    ['kind', 'volunteering'],
    ['note:volunteering', ' Brooklyn, weeknights '],
    // A note beside a kind left unticked is not saved.
    ['note:reading', 'Anything'],
  ]);

  it('can be set to events and volunteer openings with the note "Brooklyn, weeknights"', async () => {
    writes.length = 0;
    goalLive = true;
    const state = await setHelpKindsAction({}, city);
    expect(state.error).toBeUndefined();
    expect(state.done).toBeTypeOf('number');
    expect(writes).toEqual([
      {
        goalId: GOAL_ID,
        choices: [
          { kind: 'events', note: 'Brooklyn, weeknights' },
          { kind: 'volunteering', note: 'Brooklyn, weeknights' },
        ],
      },
    ]);
  });

  it('reads back as the page shows it', () => {
    const parsed = parse(city);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(readHelpKinds(JSON.parse(JSON.stringify(parsed.value)))).toEqual(parsed.value);
    expect(helpKindsLine(parsed.value)).toBe(
      'Events (Brooklyn, weeknights), Volunteer openings (Brooklyn, weeknights)',
    );
  });
});

describe('setHelpKindsAction', () => {
  it('says so when the goal has gone', async () => {
    goalLive = false;
    const state = await setHelpKindsAction({}, form([['goalId', GOAL_ID], ['kind', 'reading']]));
    expect(state.error).toBe('That goal is no longer on the page.');
    goalLive = true;
  });

  it('refuses a form with no goal', async () => {
    const state = await setHelpKindsAction({}, form([['kind', 'reading']]));
    expect(state.error).toBe('Could not tell which goal that was.');
  });
});

describe('parseHelpKindFields', () => {
  it('keeps the fixed order and treats nothing ticked as asking for nothing', () => {
    expect(parse(form([['kind', 'job_leads'], ['kind', 'reading']]))).toEqual({
      ok: true,
      value: [
        { kind: 'reading', note: null },
        { kind: 'job_leads', note: null },
      ],
    });
    expect(parse(form([]))).toEqual({ ok: true, value: [] });
  });

  it('refuses a kind that is not in the set, and a note that is too long', () => {
    expect(parse(form([['kind', 'parties']])).ok).toBe(false);
    const long = parse(form([['kind', 'courses'], ['note:courses', 'x'.repeat(HELP_NOTE_MAX + 1)]]));
    expect(long).toEqual({ ok: false, error: `Keep the note on courses under ${HELP_NOTE_MAX} characters.` });
  });
});

describe('readHelpKinds', () => {
  it('skips what it does not know and keeps the first of a repeated kind', () => {
    expect(
      readHelpKinds([
        { kind: 'events', note: 'Brooklyn' },
        { kind: 'events', note: 'Queens' },
        { kind: 'parties' },
        'reading',
        { kind: 'reading', note: '  ' },
      ]),
    ).toEqual([
      { kind: 'events', note: 'Brooklyn' },
      { kind: 'reading', note: null },
    ]);
    expect(readHelpKinds(null)).toEqual([]);
  });
});
