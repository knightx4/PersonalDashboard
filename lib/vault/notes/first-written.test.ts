import { describe, expect, it } from 'vitest';
import {
  datedEntries,
  filenameDate,
  firstWritten,
  frontmatterDate,
  imageNameDate,
  readDatedEntries,
} from '@/lib/vault/notes/first-written';

const now = new Date('2026-10-18T12:00:00Z');

describe('filenameDate', () => {
  it('reads a YYYY-MM-DD in the file name and not in its folders', () => {
    expect(filenameDate('Daily/2021-08-06 - Cafe Brazil.md', now)).toBe('2021-08-06T00:00:00.000Z');
    expect(filenameDate('2021-08-06/Notes.md', now)).toBeNull();
  });

  it('refuses a day that is not on the calendar, or one in the future', () => {
    expect(filenameDate('2023-02-30.md', now)).toBeNull();
    expect(filenameDate('2027-01-01 plan.md', now)).toBeNull();
  });
});

describe('frontmatterDate', () => {
  it('takes the earliest created-like property and leaves due dates alone', () => {
    expect(
      frontmatterDate(
        { date: '2026-08-24T00:00:00.000Z', date_created: '2026-03-31', 'due date': '2020-01-01' },
        now,
      ),
    ).toBe('2026-03-31T00:00:00.000Z');
  });

  it('ignores values that are not dates', () => {
    expect(frontmatterDate({ created: 'last spring', date: 12 }, now)).toBeNull();
  });
});

describe('imageNameDate', () => {
  it('reads the timestamp in a pasted image name', () => {
    const body = 'Diagram\n![[Pasted image 20230517222850.png]]\nand ![[Pasted image 20240101090000.jpg]]';
    expect(imageNameDate(body, now)).toBe('2023-05-17T22:28:50.000Z');
  });

  it('ignores fourteen digits that are not an image name or not a time', () => {
    expect(imageNameDate('Order 20230517222850 shipped', now)).toBeNull();
    expect(imageNameDate('![[Pasted image 20231399999999.png]]', now)).toBeNull();
  });
});

const JOURNAL = [
  '# Old',
  '## 2021',
  '',
  '[[2021-08-06 - Cafe Brazil]]',
  '[[2021-08-21]]',
  '[[2021-09-14]]',
  '',
  '## 2023',
  '',
  '2023.12.20',
  'Went to camp house',
  'Thinking like a tiger in the cage',
  '',
  '## 2024',
  '',
  '[[2024-07-17]]',
  'thinking this is very much a time of uncertainty.',
  '',
  '[[2024-02-17]]',
  'Went to camp house w mom dad and avery 🔥.',
  '',
  '# 2025',
  '',
  '2025-02-10',
  'Still want to do big things otherwise',
  '',
  '2025-04-04 was a long day, I said',
  'Thinking about love of family.',
].join('\n');

describe('datedEntries', () => {
  it('finds each dated entry, and reads it back with its date', () => {
    const entries = datedEntries(JOURNAL, now);
    expect(entries.map((entry) => entry.date)).toEqual(['2023-12-20', '2024-07-17', '2024-02-17', '2025-02-10']);

    const read = readDatedEntries(JOURNAL, entries);
    expect(read[0]).toEqual({
      date: '2023-12-20',
      text: '2023.12.20\nWent to camp house\nThinking like a tiger in the cage',
    });
    expect(read[2].text).toBe('[[2024-02-17]]\nWent to camp house w mom dad and avery 🔥.');
    // A sentence that starts with a date opens nothing: it stays in the entry before.
    expect(read[3].text).toContain('2025-04-04 was a long day');
  });

  it('counts offsets in code points, as Postgres substr does', () => {
    const body = '🔥🔥\n2025-01-24\nBowled 209.';
    const [entry] = datedEntries(body, now);
    expect(entry.offset).toBe(3);
    expect(Array.from(body).slice(entry.offset, entry.end).join('')).toBe('2025-01-24\nBowled 209.');
  });

  it('opens an entry at a heading that starts with a date', () => {
    const body = '## 2024-02-17 Camp house\nBonfire in the new pit.\n## Other\ntext';
    expect(readDatedEntries(body, datedEntries(body, now))).toEqual([
      { date: '2024-02-17', text: '## 2024-02-17 Camp house\nBonfire in the new pit.' },
    ]);
  });
});

describe('firstWritten', () => {
  const base = { path: 'Notes/Idea.md', body: 'plain text', frontmatter: {}, gitFirstCommitAt: null, now };

  it('gives nothing when there is no evidence', () => {
    expect(firstWritten(base)).toEqual({ at: null, source: null, entries: [] });
  });

  it('names each source when it is the only evidence', () => {
    expect(firstWritten({ ...base, gitFirstCommitAt: '2025-03-01T10:00:00Z' })).toMatchObject({
      at: '2025-03-01T10:00:00.000Z',
      source: 'git_first_commit',
    });
    expect(firstWritten({ ...base, path: 'Daily/2021-08-21.md' }).source).toBe('filename');
    expect(firstWritten({ ...base, body: '2023.12.20\nWent to camp' }).source).toBe('body');
    expect(firstWritten({ ...base, frontmatter: { created: '2022-05-01' } }).source).toBe('frontmatter');
    expect(firstWritten({ ...base, body: '![[Pasted image 20230517222850.png]]' }).source).toBe('image_name');
  });

  it('takes the earliest evidence', () => {
    const dated = firstWritten({
      path: 'Me/Journal.md',
      body: JOURNAL + '\n![[Pasted image 20240301120000.png]]',
      frontmatter: { created: '2024-06-01' },
      gitFirstCommitAt: '2025-09-02T19:56:18Z',
      now,
    });
    expect(dated).toMatchObject({ at: '2023-12-20T00:00:00.000Z', source: 'body' });
    expect(dated.entries).toHaveLength(4);

    expect(
      firstWritten({
        ...base,
        path: 'Daily/2024-01-05.md',
        gitFirstCommitAt: '2023-11-30T08:00:00Z',
      }),
    ).toMatchObject({ at: '2023-11-30T08:00:00.000Z', source: 'git_first_commit' });
  });

  it('drops evidence from the future or from before anyone used a notes app', () => {
    expect(firstWritten({ ...base, frontmatter: { date: '2030-01-01' } }).at).toBeNull();
    expect(firstWritten({ ...base, body: '## 1776-07-04\nThe declaration.' }).at).toBeNull();
  });
});
