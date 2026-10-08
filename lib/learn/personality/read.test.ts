import { describe, expect, it } from 'vitest';
import type { BigFiveResult, TypedResult } from './model';
import { readStatus } from './model';
import {
  chooseNotes,
  describeResult,
  mayRead,
  pointsFrom,
  readPrompt,
  readQueries,
  READ_NOTES,
  SELF_QUERY,
  type CandidateNote,
} from './read';

const BIG: BigFiveResult = {
  id: 'b1',
  kind: 'big_five',
  testName: 'Big Five',
  takenAt: '2026-10-07',
  createdAt: '2026-10-07T18:00:00Z',
  note: null,
  read: null,
  readFailedAt: null,
  answers: [],
  scores: { extraversion: 15, agreeableness: 30, conscientiousness: 45, emotional_stability: 20, intellect: 48 },
};

const TYPED: TypedResult = {
  id: 't1',
  kind: 'mbti',
  testName: 'Myers-Briggs',
  typedValue: 'INTJ',
  takenAt: '2024-03-14',
  createdAt: '2026-10-07T18:00:00Z',
  note: 'From work.',
  read: null,
  readFailedAt: null,
};

function note(id: string, path = `Ideas/${id}.md`, body = `Body of ${id}`): CandidateNote {
  return { id, path, title: id, body };
}

describe('readQueries', () => {
  it('embeds each trait sentence and the sentence about yourself for a Big Five', () => {
    const queries = readQueries(BIG);
    expect(queries).toHaveLength(6);
    expect(queries[0]).toMatch(/reserved and quiet/);
    expect(queries.at(-1)).toBe(SELF_QUERY);
  });

  it('embeds the type as written, with its note, for a typed-in result', () => {
    expect(readQueries(TYPED)).toEqual(['Myers-Briggs: INTJ. From work.', SELF_QUERY]);
  });
});

describe('mayRead', () => {
  it('reads notes under Me/, which the map leaves out as journals', () => {
    expect(mayRead({ path: 'Me/About me.md', body: 'I am quiet.' })).toBe(true);
  });

  it('never sends an excluded folder or a note holding a key', () => {
    expect(mayRead({ path: 'Career/Job Applications/Acme.md', body: 'Dear…' })).toBe(false);
    expect(mayRead({ path: 'Ideas/x.md', body: 'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' })).toBe(false);
  });
});

describe('chooseNotes', () => {
  it('puts pinned notes first, then takes the nearest to each text in turn', () => {
    const chosen = chooseNotes(
      [note('about', 'Me/About me.md')],
      [
        [note('a1'), note('a2')],
        [note('b1'), note('about', 'Me/About me.md')],
      ],
    );
    expect(chosen.map((c) => c.note.id)).toEqual(['about', 'a1', 'b1', 'a2']);
    expect(chosen[0]!.pinned).toBe(true);
  });

  it('stops at the limit and passes over empty notes', () => {
    const many = Array.from({ length: 30 }, (_, i) => note(`n${i}`));
    expect(chooseNotes([], [many])).toHaveLength(READ_NOTES);
    expect(chooseNotes([], [[note('empty', 'Ideas/e.md', '  ')]])).toEqual([]);
  });
});

describe('pointsFrom', () => {
  const notes = [{ note: note('x') }, { note: note('y') }];

  it('ties each point to the note its label names and puts clashes first', () => {
    const points = pointsFrom(
      {
        points: [
          { stance: 'agrees', note: 'N1', text: 'Fits.' },
          { stance: 'clashes', note: 'n2', text: 'Does not fit.' },
        ],
      },
      notes,
    );
    expect(points).toEqual([
      { stance: 'clashes', text: 'Does not fit.', note: { id: 'y', title: 'y', path: 'Ideas/y.md' } },
      { stance: 'agrees', text: 'Fits.', note: { id: 'x', title: 'x', path: 'Ideas/x.md' } },
    ]);
  });

  it('drops a point naming a note it was not given, or with no text', () => {
    const points = pointsFrom(
      {
        points: [
          { stance: 'agrees', note: 'N9', text: 'Made up.' },
          { stance: 'agrees', note: 'N1', text: ' ' },
          { stance: 'maybe', note: 'N1', text: 'Unsure.' },
        ],
      },
      notes,
    );
    expect(points).toEqual([]);
  });

  it('is null for input that is not the tool’s shape', () => {
    expect(pointsFrom({ nope: true }, notes)).toBeNull();
  });
});

describe('the prompt', () => {
  it('gives the scores in words and labels each note', () => {
    const text = readPrompt(describeResult(BIG, [BIG, TYPED]), [{ note: note('x'), pinned: false }]);
    expect(text).toMatch(/Extraversion 13 \(low/);
    expect(text).toMatch(/Myers-Briggs: INTJ/);
    expect(text).toMatch(/N1: "x"/);
  });
});

describe('readStatus', () => {
  const now = Date.parse('2026-10-07T18:02:00Z');
  const read = { points: [], model: 'm', at: '2026-10-07T18:01:00Z' };

  it('is pending just after a save and none once the wait is over', () => {
    expect(readStatus(BIG, now)).toBe('pending');
    expect(readStatus(BIG, now + 60 * 60_000)).toBe('none');
  });

  it('is failed when the last attempt failed after the kept read', () => {
    expect(readStatus({ ...BIG, read }, now)).toBe('ready');
    expect(readStatus({ ...BIG, read, readFailedAt: '2026-10-07T18:01:30Z' }, now)).toBe('failed');
    expect(readStatus({ ...BIG, readFailedAt: '2026-10-07T18:00:30Z' }, now)).toBe('failed');
    expect(readStatus({ ...BIG, read, readFailedAt: '2026-10-07T18:00:30Z' }, now)).toBe('ready');
  });
});
