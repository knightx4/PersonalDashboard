import { describe, expect, it } from 'vitest';
import { dateNotes, type DatingPorts, type DueNote, type NoteDating } from '@/lib/vault/sync/dating';

function note(path: string, extra: Partial<DueNote> = {}): DueNote {
  return {
    id: `id-${path}`,
    path,
    body: 'text',
    frontmatter: {},
    blobSha: `sha-${path}`,
    gitFirstCommitAt: null,
    gitFirstCommitCheckedAt: null,
    ...extra,
  };
}

/** A store whose due list shrinks as notes are dated with a GitHub answer, like the generated column. */
function store(notes: DueNote[], firstCommitAt?: DatingPorts['firstCommitAt']) {
  const saved = new Map<string, NoteDating>();
  const asked: string[] = [];
  const ports: DatingPorts = {
    async loadDue(after, limit) {
      return [...notes]
        .sort((x, y) => (x.path < y.path ? -1 : 1))
        .filter((n) => !saved.get(n.id)?.gitFirstCommitCheckedAt)
        .filter((n) => after === null || n.path > after)
        .slice(0, limit);
    },
    ...(firstCommitAt
      ? {
          firstCommitAt: async (path: string) => {
            asked.push(path);
            return firstCommitAt(path);
          },
        }
      : {}),
    async save(rows) {
      for (const row of rows) saved.set(row.id, row);
    },
    now: () => Date.parse('2026-10-18T12:00:00Z'),
  };
  return { ports, saved, asked };
}

const far = Date.parse('2026-10-18T13:00:00Z');

describe('dateNotes', () => {
  it('asks GitHub once per note and records the answer with the earliest date', async () => {
    const { ports, saved, asked } = store(
      [note('a.md'), note('Daily/2021-08-21.md'), note('c.md')],
      async (path) => (path === 'c.md' ? null : '2024-05-01T10:00:00Z'),
    );

    const result = await dateNotes({ ports, deadline: far });

    expect(result).toEqual({ dated: 3, lookedUp: 3, failed: 0, complete: true });
    expect(asked).toEqual(['Daily/2021-08-21.md', 'a.md', 'c.md']);
    expect(saved.get('id-a.md')).toMatchObject({ firstWrittenSource: 'git_first_commit', blobSha: 'sha-a.md' });
    expect(saved.get('id-Daily/2021-08-21.md')).toMatchObject({
      firstWrittenAt: '2021-08-21T00:00:00.000Z',
      firstWrittenSource: 'filename',
    });
    // No commits is an answer: checked, and no date.
    expect(saved.get('id-c.md')).toMatchObject({ firstWrittenAt: null, gitFirstCommitAt: null });
    expect(saved.get('id-c.md')?.gitFirstCommitCheckedAt).not.toBeNull();
  });

  it('resumes where the cap stopped it, dating the rest from their text meanwhile', async () => {
    const notes = [note('a.md'), note('b.md'), note('2020-01-02 c.md')];
    const { ports, saved, asked } = store(notes, async () => '2025-01-01T00:00:00Z');

    const first = await dateNotes({ ports, deadline: far, lookupLimit: 1 });
    expect(first).toMatchObject({ dated: 3, lookedUp: 1, complete: false });
    // Not asked yet, and dated from what the note itself holds: nothing here.
    expect(saved.get('id-b.md')).toMatchObject({ firstWrittenAt: null, gitFirstCommitCheckedAt: null });

    const second = await dateNotes({ ports, deadline: far });
    expect(second).toMatchObject({ dated: 2, lookedUp: 2, complete: true });
    expect(asked).toEqual(['2020-01-02 c.md', 'a.md', 'b.md']);
    expect(saved.get('id-2020-01-02 c.md')?.firstWrittenSource).toBe('filename');
    expect(saved.get('id-b.md')?.firstWrittenSource).toBe('git_first_commit');
  });

  it('re-dates a changed note from its stored commit without asking again', async () => {
    const changed = note('a.md', {
      body: '2019-03-03\nan entry',
      gitFirstCommitAt: '2024-05-01T10:00:00Z',
      gitFirstCommitCheckedAt: '2026-10-01T00:00:00Z',
    });
    const { ports, saved, asked } = store([changed], async () => '2000-01-01T00:00:00Z');

    await dateNotes({ ports, deadline: far });
    expect(asked).toEqual([]);
    expect(saved.get('id-a.md')).toMatchObject({ firstWrittenSource: 'body', firstWrittenAt: '2019-03-03T00:00:00.000Z' });
  });

  it('stops asking after repeated failures and leaves those notes due', async () => {
    const notes = Array.from({ length: 20 }, (_, i) => note(`n${String(i).padStart(2, '0')}.md`));
    const { ports, saved, asked } = store(notes, async () => {
      throw new Error('rate limit');
    });

    const result = await dateNotes({ ports, deadline: far });
    expect(result.complete).toBe(false);
    expect(result.dated).toBe(20);
    expect(asked.length).toBeLessThan(20);
    expect([...saved.values()].every((row) => row.gitFirstCommitCheckedAt === null)).toBe(true);
  });

  it('dates from the text alone when the source keeps no history', async () => {
    const { ports, saved } = store([note('Daily/2022-02-02.md')]);
    const result = await dateNotes({ ports, deadline: far });
    expect(result).toMatchObject({ dated: 1, lookedUp: 0, complete: false });
    expect(saved.get('id-Daily/2022-02-02.md')?.firstWrittenSource).toBe('filename');
  });
});
