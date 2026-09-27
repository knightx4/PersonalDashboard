import { describe, expect, it } from 'vitest';
import { handInLines, markPointsPrompt, readPointMarks, toPointMarks } from './point-marks';

const points = ['Net revenue retention is 112%, within a point.', 'Expansion is counted, new customers are not.'];

describe('handInLines', () => {
  it('lists the figures by label, says which were left blank, then the working', () => {
    expect(
      handInLines({
        answer: '  Took ending MRR from the starting cohort over its starting MRR. ',
        figures: [
          { label: 'NRR', value: ' 112% ' },
          { label: 'Expansion', value: '' },
        ],
      }),
    ).toEqual([
      'Figures handed in:',
      '- NRR: 112%',
      '- Expansion: (left blank)',
      '',
      'Working handed in:',
      'Took ending MRR from the starting cohort over its starting MRR.',
    ]);
  });

  it('says so when nothing was handed in', () => {
    expect(handInLines({ answer: ' ', figures: [] })).toEqual(['Nothing was handed in.']);
  });
});

describe('markPointsPrompt', () => {
  it('numbers the points and gives the reference and the hand-in', () => {
    const prompt = markPointsPrompt({
      context: ['Track: SaaS metrics'],
      task: 'Work out NRR from the table.',
      points,
      reference: 'NRR = 1,120 / 1,000 = 112%.',
      handIn: { answer: '', figures: [{ label: 'NRR', value: '112%' }] },
      tool: 'report_marks',
    });
    expect(prompt).toContain('1. Net revenue retention is 112%, within a point.');
    expect(prompt).toContain('2. Expansion is counted, new customers are not.');
    expect(prompt).toContain('NRR = 1,120 / 1,000 = 112%.');
    expect(prompt).toContain('- NRR: 112%');
    expect(prompt.endsWith('Call report_marks with a mark for every point, by its number.')).toBe(true);
  });
});

describe('toPointMarks', () => {
  it('passes only when every point is met', () => {
    const all = toPointMarks(points, {
      marks: [
        { number: 1, met: true, note: 'Right figure.' },
        { number: 2, met: true, note: 'Right scope.' },
      ],
    });
    expect(all).toEqual({
      ok: true,
      passed: true,
      marks: [
        { point: points[0], met: true, note: 'Right figure.' },
        { point: points[1], met: true, note: 'Right scope.' },
      ],
    });
    const one = toPointMarks(points, {
      marks: [
        { number: 2, met: false, note: 'New customers were counted.' },
        { number: 1, met: true, note: 'Right figure.' },
      ],
    });
    expect(one.ok && one.passed).toBe(false);
    expect(one.ok && one.marks.map((mark) => mark.met)).toEqual([true, false]);
  });

  it('refuses a report that leaves a point unmarked, and keeps the first of a repeated one', () => {
    expect(toPointMarks(points, { marks: [{ number: 1, met: true, note: '' }] })).toEqual({
      ok: false,
      reason: 'The marker left point 2 unmarked.',
    });
    const repeated = toPointMarks(points, {
      marks: [
        { number: 1, met: false, note: 'First.' },
        { number: 1, met: true, note: 'Second.' },
        { number: 2, met: true, note: '' },
      ],
    });
    expect(repeated.ok && repeated.marks).toEqual([
      { point: points[0], met: false, note: 'First.' },
      { point: points[1], met: true, note: 'Met.' },
    ]);
  });

  it('refuses to pass work with no points', () => {
    expect(toPointMarks([], { marks: [] }).ok).toBe(false);
  });
});

describe('readPointMarks', () => {
  it('reads the stored column and drops malformed rows', () => {
    expect(readPointMarks([{ point: 'A', met: true, note: 'Yes.' }, { met: 'yes' }, null])).toEqual([
      { point: 'A', met: true, note: 'Yes.' },
    ]);
    expect(readPointMarks('nope')).toEqual([]);
  });
});
