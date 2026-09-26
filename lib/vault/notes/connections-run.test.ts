import { describe, expect, it } from 'vitest';
import { EMPTY_USAGE, type SpendReport } from '@/lib/core/spend/pricing';
import type { NeighbourPair } from '@/lib/vault/notes/connections';
import {
  connectionWeek,
  runConnectionsFor,
  type ConnectionRow,
  type ConnectionRunPorts,
} from '@/lib/vault/notes/connections-run';
import { shapeConnections } from '@/lib/vault/notes/connections-load';

/** The weekly run over fake ports, and the page's shaping of what it wrote. */

const NOW = new Date('2026-09-28T13:37:00Z');

const kept: NeighbourPair = {
  recentId: 'r1',
  recentPath: 'Yale/MGT 649 - World Financial History.md',
  recentTitle: 'MGT 649 - World Financial History',
  recentChars: 12_000,
  olderId: 'o1',
  olderPath: 'Pending/Money Changes Everything.md',
  olderTitle: 'Money Changes Everything',
  olderChars: 9_000,
  similarity: 0.768,
  mutualRank: 1,
};

function fakePorts(options: { pairs?: NeighbourPair[]; ran?: boolean; sentences?: (string | null)[] } = {}) {
  const written: ConnectionRow[] = [];
  const ledger: SpendReport[] = [];
  const asked: string[] = [];
  const ports: ConnectionRunPorts = {
    async hasWeek() {
      return options.ran ?? false;
    },
    async neighbours(_userId, since) {
      asked.push(since);
      return options.pairs ?? [];
    },
    async openings(_userId, ids) {
      return new Map(ids.map((id) => [id, `opening of ${id}`]));
    },
    async sentences(groups, onSpend) {
      onSpend({ model: 'claude-haiku-4-5', usage: { ...EMPTY_USAGE, inputTokens: 900 } });
      return options.sentences ?? groups.map(() => 'Both follow how money grew up with the first cities.');
    },
    async ledger(_userId, report) {
      ledger.push(report);
    },
    async write(rows) {
      written.push(...rows);
    },
  };
  return { ports, written, ledger, asked };
}

describe('connectionWeek', () => {
  it('keys the week by the run day and looks back seven days', () => {
    expect(connectionWeek(NOW)).toEqual({ weekEnding: '2026-09-28', since: '2026-09-21T13:37:00.000Z' });
  });
});

describe('runConnectionsFor', () => {
  it('writes the week with its sentences and records the call', async () => {
    const { ports, written, ledger, asked } = fakePorts({ pairs: [kept] });
    expect(await runConnectionsFor(ports, 'u1', NOW)).toEqual({
      status: 'written',
      pairs: 1,
      connections: 1,
      sentences: 1,
    });
    expect(asked).toEqual(['2026-09-21T13:37:00.000Z']);
    expect(written).toEqual([
      {
        user_id: 'u1',
        week_ending: '2026-09-28',
        older_note_id: 'o1',
        recent_note_ids: ['r1'],
        sentence: 'Both follow how money grew up with the first cities.',
        similarity: 0.768,
      },
    ]);
    expect(ledger).toHaveLength(1);
  });

  it('stores the connection without a sentence when none came back', async () => {
    const { ports, written } = fakePorts({ pairs: [kept], sentences: [null] });
    await runConnectionsFor(ports, 'u1', NOW);
    expect(written[0]!.sentence).toBeNull();
  });

  it('writes nothing in a quiet week and calls no model', async () => {
    const { ports, written, ledger } = fakePorts({ pairs: [{ ...kept, similarity: 0.5 }] });
    expect(await runConnectionsFor(ports, 'u1', NOW)).toEqual({ status: 'quiet', pairs: 1 });
    expect(written).toEqual([]);
    expect(ledger).toEqual([]);
  });

  it('does nothing when the week has already been written', async () => {
    const { ports, asked } = fakePorts({ pairs: [kept], ran: true });
    expect(await runConnectionsFor(ports, 'u1', NOW)).toEqual({ status: 'already-run' });
    expect(asked).toEqual([]);
  });
});

describe('shapeConnections', () => {
  const row = {
    id: 'c1',
    week_ending: '2026-09-28',
    sentence: 'Both follow money.',
    older_note_id: 'o1',
    recent_note_ids: ['r1', 'r2'],
  };

  it('names and links each note, leaving out one deleted since', () => {
    expect(
      shapeConnections([row], [
        { id: 'o1', path: 'Pending/Money Changes Everything.md', title: 'Money Changes Everything' },
        { id: 'r1', path: 'Yale/MGT 649.md', title: null },
      ]),
    ).toEqual([
      {
        id: 'c1',
        sentence: 'Both follow money.',
        older: { noteId: 'o1', title: 'Money Changes Everything', href: '/vault/n/Pending/Money%20Changes%20Everything.md' },
        recent: [{ noteId: 'r1', title: 'Yale/MGT 649.md', href: '/vault/n/Yale/MGT%20649.md' }],
      },
    ]);
  });

  it('drops a connection whose older note or every recent note is gone', () => {
    expect(shapeConnections([row], [{ id: 'r1', path: 'a.md', title: 'A' }])).toEqual([]);
    expect(shapeConnections([row], [{ id: 'o1', path: 'b.md', title: 'B' }])).toEqual([]);
  });
});
