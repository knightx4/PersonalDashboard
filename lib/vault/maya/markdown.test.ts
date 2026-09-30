import { describe, expect, it } from 'vitest';
import { threadMarkdown, wikilink, type ThreadMarkdownInput } from './markdown';
import type { MayaPoint } from './verify';

/** A thread copied out for Obsidian: its sections, and a wikilink for every cited note. */

const POINTS: MayaPoint[] = [
  {
    kind: 'point',
    rank: 1,
    claim: 'Attention is the scarce thing',
    argument: 'Both notes treat focus as spent, not stored.',
    notes: [
      {
        noteId: 'a',
        title: 'On focus',
        quote: 'Focus is a budget.\nSpend it early.',
        point: 'Frames focus as spending.',
      },
      {
        noteId: 'gone',
        title: 'Old [draft] | notes',
        quote: 'Mornings matter.',
        point: 'The earlier version.',
      },
    ],
    sources: [
      {
        author: 'Herbert Simon',
        work: 'Designing Organizations',
        gist: 'Information consumes attention.',
        exactText: 'a wealth of information creates a poverty of attention',
      },
      {
        author: 'Cal Newport',
        work: 'Deep Work',
        gist: 'Depth is rare and valuable.',
        exactText: null,
      },
    ],
  },
  {
    kind: 'point',
    rank: 2,
    claim: 'Habits outlast plans',
    argument: 'A plan is read once.',
    notes: [
      { noteId: 'b', title: 'Habits', quote: 'Do it daily.', point: 'Repetition over intent.' },
    ],
    sources: [],
  },
];

function input(overrides: Partial<ThreadMarkdownInput> = {}): ThreadMarkdownInput {
  return {
    question: 'What is focus for?',
    summary: 'You hold that focus is spent.\nStill open: whether it can be trained.',
    notePath: 'Journal/Focus essay.md',
    points: POINTS,
    synthesis: null,
    paths: { a: 'Ideas/On focus.md', b: 'Habits.md' },
    ...overrides,
  };
}

describe('threadMarkdown', () => {
  it('links every cited note by its Obsidian name', () => {
    const md = threadMarkdown(input());
    expect(md).toContain('A thread with Maya on [[Focus essay]].');
    expect(md).toContain('[[On focus]]: Frames focus as spending.');
    expect(md).toContain('[[Habits]]: Repetition over intent.');
    // A note no longer in the vault is linked by its cited title, with link syntax taken out.
    expect(md).toContain('[[Old draft notes]]: The earlier version.');
    const links = md.match(/\[\[[^\]]+\]\]/g) ?? [];
    expect(links).toHaveLength(4);
  });

  it('carries the question, where you have got to, and the ranked points', () => {
    const md = threadMarkdown(input());
    expect(md.startsWith('# What is focus for?\n')).toBe(true);
    expect(md).toContain(
      '## Where you have got to\n\nYou hold that focus is spent.\nStill open: whether it can be trained.',
    );
    expect(md).toContain(
      '### 1. Attention is the scarce thing\n\nBoth notes treat focus as spent, not stored.',
    );
    expect(md).toContain('### 2. Habits outlast plans');
    expect(md).toContain('> Focus is a budget.\n> Spend it early.');
    expect(md).toContain(
      '- Herbert Simon, *Designing Organizations* (paraphrased): Information consumes attention.\n  > a wealth of information creates a poverty of attention\n- Cal Newport, *Deep Work* (paraphrased): Depth is rare and valuable.',
    );
  });

  it('leaves out what the thread does not have yet', () => {
    const md = threadMarkdown(input({ summary: null, notePath: null, points: [] }));
    expect(md).toBe('# What is focus for?\n\nA thread with Maya.\n');
  });

  it('ends with the reconciliation when there is one', () => {
    const md = threadMarkdown(
      input({
        synthesis: {
          kind: 'synthesis',
          positionIds: ['p', 'q'],
          positionNames: ['Rest', 'Grind'],
          resolution: 'Both, by season.',
        },
      }),
    );
    expect(md.trimEnd().endsWith('### Reconciling “Rest” and “Grind”\n\nBoth, by season.')).toBe(
      true,
    );
  });
});

describe('wikilink', () => {
  it('drops the folder and the extension', () => {
    expect(wikilink('A/B/Note name.md')).toBe('[[Note name]]');
  });
});
