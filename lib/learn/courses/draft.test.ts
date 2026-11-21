import { describe, expect, it } from 'vitest';
import type { Lecture } from './digest';
import { assembleDraft, checkOutline, checkStage, draftProgress, readDraft } from './draft';
import { formulaProblems, stageMathsProblems } from './maths';

const LECTURES: Lecture[] = [
  {
    code: 'M01',
    title: 'Introduction',
    videoId: 'BCiZc0n6COY',
    durationSeconds: 3711,
    speaker: null,
  },
];
const WORDS = Array.from({ length: 1150 }, () => 'word').join(' ');
const BRIEF =
  'Build the bent coin example: ten flips at p = 0.1, count the typical sequences, draw them.';

const step = (title: string, clips: unknown[] = []) => ({
  title,
  gain: 'Work out the entropy of a bent coin.',
  brief: BRIEF,
  clips,
  notes: ['M01'],
});

function outline(overrides: Record<string, unknown> = {}, stages?: unknown[]) {
  return {
    maths: true,
    madeFor: 'A CPA learning information theory.',
    intro: 'One series.',
    plan: {
      intro: 'Start with entropy.',
      budgetMinutes: 30,
      stages: stages ?? [
        {
          key: 'A',
          short: 'Entropy',
          title: 'What entropy measures',
          about: 'The measure.',
          after: [],
          steps: [
            step('Surprise', [{ code: 'M01', start: '1:00', end: '9:00', listenFor: 'The coin.' }]),
          ],
        },
        {
          key: 'B',
          short: 'Codes',
          title: 'Symbol codes',
          about: 'Codes.',
          after: ['A'],
          steps: [step('Huffman')],
        },
      ],
    },
    ratings: { intro: '', rows: [{ code: 'M01', rating: 'watch', watch: '', why: 'The core.' }] },
    ideas: Array.from({ length: 5 }, (_, i) => ({ title: `Idea ${i}`, body: 'With its example.' })),
    errors: { intro: '', rows: [] },
    ...overrides,
  };
}

const written = (key: string, extra: unknown[] = []) => ({
  key,
  short: key === 'A' ? 'Entropy' : 'Codes',
  title: key === 'A' ? 'What entropy measures' : 'Symbol codes',
  about: 'Written.',
  after: key === 'A' ? [] : ['A'],
  steps: [
    {
      title: key === 'A' ? 'Surprise' : 'Huffman',
      gain: 'Work out the entropy of a bent coin.',
      blocks: [
        { type: 'text', body: `${WORDS} The entropy is $H = -\\sum p \\log_2 p$.` },
        ...extra,
      ],
    },
  ],
});

describe('checkOutline', () => {
  it('keeps an outline whose steps are briefed and whose clips fit', () => {
    expect(checkOutline(outline(), LECTURES)).toEqual({
      ok: true,
      stages: 2,
      steps: 2,
      clipMinutes: 8,
    });
  });

  it('refuses a step with no brief, a clip past the lecture, and clips over the budget', () => {
    const bad = outline({}, [
      {
        key: 'A',
        short: 'Entropy',
        title: 'What entropy measures',
        about: 'x',
        after: [],
        steps: [
          {
            ...step('Surprise', [{ code: 'M01', start: '1:00', end: '2:00:00' }]),
            brief: 'Short.',
          },
          step('More', [{ code: 'M01', start: '0:10', end: '59:00' }]),
        ],
      },
    ]);
    const checked = checkOutline(bad, LECTURES);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    const all = checked.problems.join('\n');
    expect(all).toMatch(/no brief for its writer/);
    expect(all).toMatch(/past the end of M01/);
    expect(all).toMatch(/against a budget of 30/);
  });
});

describe('checkStage and the draft', () => {
  it('checks a stage in its place and assembles the course once every stage is kept', () => {
    const plan = outline();
    expect(checkStage(plan, 'A', written('A'), LECTURES)).toMatchObject({ ok: true, steps: 1 });
    expect(checkStage(plan, 'C', written('A'), LECTURES)).toMatchObject({ ok: false });

    const partial = readDraft({ outline: plan, stages: { A: written('A') }, reviewed: ['A'] });
    expect(draftProgress(partial)).toMatchObject({
      stages: 2,
      written: ['A'],
      toWrite: ['B'],
      toReview: [],
    });
    expect(assembleDraft(partial, LECTURES)).toEqual({
      ok: false,
      problems: ['Not written yet: B.'],
    });

    const whole = readDraft({
      outline: plan,
      stages: { A: written('A'), B: written('B') },
      reviewed: [],
    });
    const assembled = assembleDraft(whole, LECTURES);
    expect(assembled.ok).toBe(true);
    if (assembled.ok) expect(assembled.digest.maths).toBe(true);
  });

  it('reads an empty draft as nothing done', () => {
    expect(draftProgress(readDraft({}))).toMatchObject({ outline: false, stages: 0, toWrite: [] });
  });
});

describe('the maths check', () => {
  it('passes formulas that set, and finds those that will not', () => {
    expect(formulaProblems('Entropy is $H = -\\sum p \\log_2 p$ bits.')).toEqual([]);
    expect(formulaProblems('$$\n\\frac{1}{2}\n$$')).toEqual([]);
    expect(formulaProblems('Broken $\\frac{1}{2$ here.').join()).toMatch(/does not parse/);
    expect(formulaProblems('Ends in a space $x $ here.').join()).toMatch(/ends in a space/);
    expect(formulaProblems('It cost 10$ in all.').join()).toMatch(/stray dollar/);
    expect(formulaProblems('Plain \\frac{1}{2} here.').join()).toMatch(/LaTeX outside a formula/);
  });

  it('finds LaTeX in the fields the page shows as plain text', () => {
    const stage = written('A', [{ type: 'figure', caption: 'Bits $H$', svg: '<svg></svg>' }]);
    expect(stageMathsProblems({ ...stage, title: 'The \\log rule' }).join('\n')).toMatch(
      /stage title/,
    );
    expect(stageMathsProblems(stage).join('\n')).toMatch(/caption/);
  });
});
