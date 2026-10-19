import { describe, expect, it, vi } from 'vitest';
import {
  mergeSyllabusWeeks,
  parseWeekTitle,
  readSyllabusWeeks,
  readWeeksAnswer,
  weeksPrompt,
  weeksTool,
  WEEKS_TOOL,
} from '@/lib/you/syllabus-weeks';
import type { CourseWeek } from '@/lib/you/transcripts';

function kept(week: number, title: string | null, extra: Partial<CourseWeek> = {}): CourseWeek {
  return { id: `w${week}`, course_id: 'c', week, title, edited_at: null, removed_at: null, ...extra };
}

describe('weeksTool and weeksPrompt', () => {
  it('ask for weeks through the one tool, naming the course', () => {
    expect(weeksTool().name).toBe(WEEKS_TOOL);
    expect(weeksPrompt('ECON 101')).toContain('"ECON 101"');
    expect(weeksPrompt('ECON 101')).toContain(WEEKS_TOOL);
  });
});

describe('readWeeksAnswer', () => {
  it('keeps each week once, in order, with its title cleaned and a blank title as none', () => {
    expect(
      readWeeksAnswer({
        weeks: [
          { week: 2, title: '  Supply and\n demand ' },
          { week: 1, title: 'Scarcity' },
          { week: 2, title: 'Again' },
          { week: '3', title: '' },
          { week: 61, title: 'Too far' },
          { week: 1.5, title: 'Half' },
          'junk',
        ],
        no_weeks: null,
      }),
    ).toEqual({
      ok: true,
      weeks: [
        { week: 1, title: 'Scarcity' },
        { week: 2, title: 'Supply and demand' },
        { week: 3, title: null },
      ],
    });
  });

  it('says why when there are no weeks', () => {
    expect(readWeeksAnswer({ weeks: [], no_weeks: 'it lists topics with no schedule' })).toEqual({
      ok: false,
      error: 'Dash found no weeks in it. It lists topics with no schedule.',
    });
    expect(readWeeksAnswer(null)).toEqual({
      ok: false,
      error: 'Dash found no weeks in the syllabus, so none were laid out.',
    });
  });
});

describe('readSyllabusWeeks', () => {
  it('sends the file as text and reads the answer', async () => {
    const ask = vi.fn().mockResolvedValue({ ok: true, input: { weeks: [{ week: 1, title: 'Intro' }], no_weeks: null } });
    const read = await readSyllabusWeeks(
      { name: 'syllabus.txt', bytes: new TextEncoder().encode('Week 1: Intro'), courseTitle: 'ECON 101' },
      ask,
    );
    expect(read).toEqual({ ok: true, weeks: [{ week: 1, title: 'Intro' }] });
    expect(ask.mock.calls[0][0]).toEqual({ kind: 'text', text: 'Week 1: Intro' });
  });

  it('passes on a failed call', async () => {
    const ask = vi.fn().mockResolvedValue({ ok: false, error: 'Nothing came back. Try again.' });
    const read = await readSyllabusWeeks(
      { name: 'syllabus.txt', bytes: new TextEncoder().encode('x'), courseTitle: 'ECON 101' },
      ask,
    );
    expect(read).toEqual({ ok: false, error: 'Nothing came back. Try again.' });
  });
});

describe('mergeSyllabusWeeks', () => {
  it('adds new weeks, retitles untouched ones and drops untouched ones the read no longer names', () => {
    const change = mergeSyllabusWeeks(
      [kept(1, 'Scarcity'), kept(2, 'Old title'), kept(9, 'Dropped')],
      [
        { week: 1, title: 'Scarcity' },
        { week: 2, title: 'Supply and demand' },
        { week: 3, title: 'Elasticity' },
      ],
    );
    expect(change).toEqual({
      upsert: [
        { week: 2, title: 'Supply and demand' },
        { week: 3, title: 'Elasticity' },
      ],
      remove: ['w9'],
    });
  });

  it('leaves weeks the person edited or removed as they left them', () => {
    const change = mergeSyllabusWeeks(
      [
        kept(1, 'My title', { edited_at: '2026-10-18T00:00:00Z' }),
        kept(2, 'Removed', { removed_at: '2026-10-18T00:00:00Z' }),
        kept(7, 'Mine, not in the read', { edited_at: '2026-10-18T00:00:00Z' }),
      ],
      [
        { week: 1, title: 'Scarcity' },
        { week: 2, title: 'Supply and demand' },
      ],
    );
    expect(change).toEqual({ upsert: [], remove: [] });
  });
});

describe('parseWeekTitle', () => {
  it('reads blank as no title and refuses one past 200 characters', () => {
    expect(parseWeekTitle('  ')).toEqual({ ok: true, title: null });
    expect(parseWeekTitle(' Elasticity ')).toEqual({ ok: true, title: 'Elasticity' });
    expect(parseWeekTitle('x'.repeat(201))).toEqual({ ok: false });
  });
});
