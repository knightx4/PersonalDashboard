import { describe, expect, it } from 'vitest';
import type { LinkedFile } from '@/lib/files/files';
import { goalFileMeta, goalFileRows, stepTitlesIn, unreadWords } from './goal-files';

const GOAL = '11111111-1111-4111-8111-111111111111';
const STEP = '22222222-2222-4222-8222-222222222222';
const SUB = '33333333-3333-4333-8333-333333333333';

function file(id: string, origin: string | null, extra: Partial<LinkedFile> = {}): LinkedFile {
  return {
    linkId: `link-${id}`,
    fileId: id,
    title: `File ${id}`,
    summary: null,
    updatedAt: '2026-10-12T09:00:00Z',
    origin,
    madeBy: 'claude',
    version: 1,
    ...extra,
  };
}

describe('the files on a goal page (plan #1860)', () => {
  const titles = stepTitlesIn([
    [{ id: STEP, title: 'List the firms hiring', children: [{ id: SUB, title: 'Draft the note', children: [] }] }],
  ]);

  it('names the step each file was written for, at any depth', () => {
    const rows = goalFileRows(
      GOAL,
      { [STEP]: [file('a', `goals.items:${STEP}`)], [SUB]: [file('b', `goals.items:${SUB}`)] },
      titles,
    );
    expect(rows.map((row) => row.meta)).toEqual([
      'Written by Dash for “List the firms hiring”',
      'Written by Dash for “Draft the note”',
    ]);
    expect(rows.every((row) => row.byDash)).toBe(true);
  });

  it('lists each file once, the goal’s own first, and names no step for a file written for the goal', () => {
    const shared = file('a', `goals.items:${STEP}`, { version: 3 });
    const rows = goalFileRows(
      GOAL,
      { [STEP]: [shared], [GOAL]: [file('g', `goals.items:${GOAL}`), shared] },
      titles,
    );
    expect(rows.map((row) => [row.fileId, row.meta])).toEqual([
      ['g', 'Written by Dash'],
      ['a', 'Written by Dash for “List the firms hiring” · version 3'],
    ]);
  });

  it('falls back to the step that links it when the origin is not on this goal', () => {
    const rows = goalFileRows(GOAL, { [STEP]: [file('x', 'goals.items:elsewhere')] }, titles);
    expect(rows[0].meta).toBe('Written by Dash for “List the firms hiring”');
  });

  it('says when the person wrote it', () => {
    expect(goalFileMeta({ madeBy: 'you', version: 2 }, null)).toBe('Written by you · version 2');
  });

  it('marks the files Dash wrote that have not been opened, and counts them (plan #1861)', () => {
    const rows = goalFileRows(
      GOAL,
      {
        [STEP]: [
          file('new', `goals.items:${STEP}`, { readAt: null }),
          file('read', `goals.items:${STEP}`, { readAt: '2026-10-12T10:00:00Z' }),
          file('mine', `goals.items:${STEP}`, { madeBy: 'you', readAt: null }),
        ],
      },
      titles,
    );
    expect(rows.map((row) => [row.fileId, row.unread])).toEqual([
      ['new', true],
      ['read', false],
      ['mine', false],
    ]);
    expect(unreadWords(rows)).toBe('1 not read');
    expect(unreadWords(rows.filter((row) => !row.unread))).toBeNull();
  });
});
