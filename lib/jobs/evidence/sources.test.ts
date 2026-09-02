import { describe, expect, it } from 'vitest';
import {
  MAX_SOURCE_CHARS,
  assembleAnswersSource,
  assembleDebriefsSource,
  assembleResumeSource,
} from './sources';

describe('assembleResumeSource', () => {
  it('returns the trimmed text', () => {
    expect(assembleResumeSource('  Analyst, Acme  ')).toBe('Analyst, Acme');
  });

  it('is empty when there is no pasted text', () => {
    expect(assembleResumeSource(null)).toBe('');
  });

  it('cuts on a paragraph boundary rather than mid-story', () => {
    const first = 'a'.repeat(MAX_SOURCE_CHARS - 100);
    const text = `${first}\n\n${'b'.repeat(500)}`;
    expect(assembleResumeSource(text)).toBe(first);
  });

  it('cuts hard when there is no boundary to cut on', () => {
    const text = 'a'.repeat(MAX_SOURCE_CHARS + 500);
    expect(assembleResumeSource(text)).toHaveLength(MAX_SOURCE_CHARS);
  });
});

describe('assembleAnswersSource', () => {
  it('pairs each question with its answer', () => {
    expect(
      assembleAnswersSource([
        { question: 'Tell us about a time you led', answer: 'I ran the close rebuild.' },
        { question: 'A conflict you resolved', answer: 'Two teams wanted the same window.' },
      ]),
    ).toBe(
      'Question: Tell us about a time you led\nAnswer: I ran the close rebuild.\n\n' +
        'Question: A conflict you resolved\nAnswer: Two teams wanted the same window.',
    );
  });

  it('drops a row with no answer', () => {
    expect(assembleAnswersSource([{ question: 'Anything?', answer: '   ' }])).toBe('');
  });

  it('says the question was not recorded rather than leaving a dangling label', () => {
    expect(assembleAnswersSource([{ question: '', answer: 'I ran the rebuild.' }])).toBe(
      'Question: (not recorded)\nAnswer: I ran the rebuild.',
    );
  });
});

describe('assembleDebriefsSource', () => {
  it('labels the separate columns rather than concatenating them blind', () => {
    expect(
      assembleDebriefsSource([
        {
          label: 'Acme, Senior Analyst',
          debrief: 'Panel of three.',
          wentWell: 'The close story landed.',
          wentPoorly: 'Fumbled the SQL question.',
        },
      ]),
    ).toBe(
      'Interview — Acme, Senior Analyst\nPanel of three.\n' +
        'What went well: The close story landed.\n' +
        'What went poorly: Fumbled the SQL question.',
    );
  });

  it('keeps a debrief that has only one of the three columns', () => {
    expect(
      assembleDebriefsSource([
        { label: null, debrief: null, wentWell: 'The close story landed.', wentPoorly: '' },
      ]),
    ).toBe('Interview\nWhat went well: The close story landed.');
  });

  it('skips an interview with nothing written up', () => {
    expect(
      assembleDebriefsSource([
        { label: 'Acme', debrief: '', wentWell: null, wentPoorly: null },
        { label: 'Beta', debrief: 'Went long.', wentWell: null, wentPoorly: null },
      ]),
    ).toBe('Interview — Beta\nWent long.');
  });
});
