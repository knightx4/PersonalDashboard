import { describe, expect, it } from 'vitest';
import type { AcceptResult } from '@/lib/vault/map/accept';
import type { MapNote, ProposeResult } from '@/lib/vault/map/extract';
import type { NoteMapProposal } from '@/lib/vault/map/proposal';
import {
  acceptedRow,
  beforeRead,
  refusedRow,
  runSweepSlice,
  SWEEP_BATCH,
  type SweepNoteRow,
  type SweepPorts,
} from '@/lib/vault/map/sweep';

const LONG = 'Cities should let people build more homes near the jobs they already have. '.repeat(3);

function note(path: string, body = LONG, blobSha = `sha-${path}`): MapNote {
  return { id: `id-${path}`, path, title: path.replace(/\.md$/, ''), body, blobSha };
}

function proposal(n: MapNote, extra: Partial<NoteMapProposal> = {}): NoteMapProposal {
  return {
    noteId: n.id,
    blobSha: n.blobSha,
    verdict: { noteClass: 'knowledge', isEvidence: false, reason: 'Argues for housing.' },
    themes: [{ key: 't0', name: 'Housing', about: 'Where homes go.', basis: 'Read.' }],
    positions: [],
    edges: [],
    dropped: [],
    chunks: { read: 1, failed: [] },
    skipped: [],
    ...extra,
  };
}

/**
 * A vault in memory and a clock that moves ten seconds per note sent, so a
 * budget stops a slice partway through the vault.
 */
function vault(notes: MapNote[], opts: { settled?: Map<string, string> } = {}) {
  const sorted = [...notes].sort((a, b) => (a.path < b.path ? -1 : 1));
  const rows = new Map<string, SweepNoteRow>();
  const sent: string[] = [];
  let clock = 0;
  let afterPath: string | null = null;
  let running = true;

  const ports: SweepPorts = {
    notesAfter: async (after, limit) =>
      sorted.filter((n) => after === null || n.path > after).slice(0, limit),
    reachedInSweep: async (ids) => new Set(ids.filter((id) => rows.has(id))),
    settledVersions: async () => opts.settled ?? new Map(),
    themeNames: async () => ['Housing'],
    propose: async (n): Promise<ProposeResult> => {
      sent.push(n.path);
      clock += 10_000;
      return { ok: true, proposal: proposal(n) };
    },
    accept: async (): Promise<AcceptResult> => ({
      ok: true,
      themes: 1,
      positions: 0,
      newPositions: 0,
      edges: 0,
    }),
    record: async (row) => {
      rows.set(row.noteId, row);
    },
    saveProgress: async (path) => {
      afterPath = path;
    },
    stillRunning: async () => running,
    now: () => clock,
  };

  return {
    ports,
    rows,
    sent,
    get afterPath() {
      return afterPath;
    },
    stop() {
      running = false;
    },
  };
}

describe('runSweepSlice', () => {
  it('finishes a vault across several calls, each resuming where the last saved', async () => {
    const notes = Array.from({ length: 20 }, (_, i) => note(`Notes/${String(i).padStart(2, '0')}.md`));
    const v = vault(notes);

    let calls = 0;
    let result;
    do {
      result = await runSweepSlice({ afterPath: v.afterPath, ports: v.ports, budgetMs: 100_000 });
      calls += 1;
    } while (!result.finished && calls < 20);

    expect(result.finished).toBe(true);
    expect(calls).toBeGreaterThan(1);
    expect(v.rows.size).toBe(20);
    // Every note sent once, however many calls it took.
    expect(new Set(v.sent).size).toBe(20);
    expect(v.sent).toHaveLength(20);
    expect([...v.rows.values()].every((row) => row.outcome === 'read')).toBe(true);
  });

  it('does not send a journal, a note with a key or a short note, and says why', async () => {
    const v = vault([
      note('Me/Journal.md'),
      note('Keys.md', `${LONG} sk-ant-api03-abc`),
      note('Stub.md', 'Too brief.'),
      note('Housing.md'),
    ]);

    const result = await runSweepSlice({ afterPath: null, ports: v.ports, budgetMs: 200_000 });

    expect(result.finished).toBe(true);
    expect(v.sent).toEqual(['Housing.md']);
    expect(v.rows.get('id-Me/Journal.md')?.outcome).toBe('journal');
    expect(v.rows.get('id-Keys.md')?.outcome).toBe('credential');
    expect(v.rows.get('id-Stub.md')?.outcome).toBe('too_short');
    expect(v.rows.get('id-Housing.md')?.outcome).toBe('read');
  });

  it('skips notes a cut-off call already reached, rather than reading them twice', async () => {
    const notes = Array.from({ length: SWEEP_BATCH }, (_, i) => note(`N${i}.md`));
    const v = vault(notes);
    // A call that died after marking two notes and before saving its position.
    await v.ports.record({ ...refusedRow(notes[0], { ok: false, reason: 'error', detail: 'cut off' }) });
    await v.ports.record({ ...refusedRow(notes[1], { ok: false, reason: 'error', detail: 'cut off' }) });

    await runSweepSlice({ afterPath: null, ports: v.ports, budgetMs: 200_000 });

    expect(v.sent).toEqual(notes.slice(2).map((n) => n.path));
    expect(v.rows.get(notes[0].id)?.outcome).toBe('failed');
  });

  it('does not send a note an earlier sweep settled at the same version', async () => {
    const same = note('Same.md');
    const changed = note('Changed.md');
    const v = vault([same, changed], {
      settled: new Map([
        [same.id, same.blobSha],
        [changed.id, 'an-older-sha'],
      ]),
    });

    await runSweepSlice({ afterPath: null, ports: v.ports, budgetMs: 200_000 });

    expect(v.sent).toEqual(['Changed.md']);
    expect(v.rows.get(same.id)?.outcome).toBe('unchanged');
  });

  it('stops when the person stops the sweep, without saving past what it did', async () => {
    const v = vault([note('A.md'), note('B.md')]);
    v.stop();

    const result = await runSweepSlice({ afterPath: null, ports: v.ports, budgetMs: 200_000 });

    expect(result).toMatchObject({ stopped: true, finished: false, reached: 0 });
    expect(v.afterPath).toBeNull();
  });

  it('records a note whose reading throws as failed and carries on', async () => {
    const v = vault([note('A.md'), note('B.md')]);
    v.ports.propose = async (n) => {
      if (n.path === 'A.md') throw new Error('overloaded');
      return { ok: true, proposal: proposal(n) };
    };

    const result = await runSweepSlice({ afterPath: null, ports: v.ports, budgetMs: 200_000 });

    expect(result.finished).toBe(true);
    expect(v.rows.get('id-A.md')).toMatchObject({ outcome: 'failed', detail: 'overloaded' });
    expect(v.rows.get('id-B.md')?.outcome).toBe('read');
  });
});

describe('the row for each note', () => {
  it('counts a journal as a journal even when it is also short', () => {
    expect(beforeRead(note('Me/Dreams.md', 'Short.'), undefined)?.outcome).toBe('journal');
  });

  it('names a record and an empty reading apart', () => {
    const n = note('A.md');
    const verdict = { noteClass: 'operational' as const, isEvidence: false, reason: 'A packing list.' };
    expect(refusedRow(n, { ok: false, reason: 'operational', verdict, detail: 'Not read: A packing list.' }))
      .toMatchObject({ outcome: 'record', detail: 'Not read: A packing list.' });
    expect(
      refusedRow(n, { ok: false, reason: 'nothing-in-it', verdict, detail: 'Argues nothing.' }).outcome,
    ).toBe('nothing');
  });

  it('keeps what was not read and which sections failed, even when the write fails', () => {
    const n = note('Long.md');
    const skipped = [
      {
        reason: 'read-cap' as const,
        start: 400_000,
        end: 410_000,
        chars: 10_000,
        chunks: 3,
        from: 'Appendix',
        detail: 'Not read: past the first 400,000 characters.',
      },
    ];
    const failed = [{ title: 'Part two', detail: 'overloaded' }];
    const p = proposal(n, { skipped, chunks: { read: 4, failed } });

    const written = acceptedRow(n, p, { ok: true, themes: 2, positions: 5, newPositions: 4, edges: 1 });
    expect(written).toMatchObject({ outcome: 'read', positions: 5, newPositions: 4, skipped, failedChunks: failed });

    const refused = acceptedRow(n, p, { ok: false, reason: 'stale-note', detail: 'The note has changed.' });
    expect(refused).toMatchObject({ outcome: 'failed', detail: 'The note has changed.', skipped, failedChunks: failed });
  });
});
