import { describe, expect, it, vi } from 'vitest';
import {
  entryDate,
  extractNoteLines,
  haikuForExtracts,
  keepLines,
  MAX_LINES,
  type ExtractLine,
  type ExtractNote,
  type ExtractPorts,
} from '@/lib/you/note-extracts';

const NOW = Date.parse('2026-10-18T12:00:00Z');

const BODY = `## 2026-10-02
Woke up **exhausted** again, running on fumes.

I am at my best in Socrates Mode: asking until the answer holds.
I want to live somewhere I can walk to everything.`;

function note(id: string, extra: Partial<ExtractNote> = {}): ExtractNote {
  return { id, userId: 'u1', path: `Me/${id}.md`, title: id, body: BODY, blobSha: `sha-${id}`, ...extra };
}

function ports(due: ExtractNote[], overrides: Partial<ExtractPorts> = {}) {
  const saved: Array<{ id: string; lines: ExtractLine[] }> = [];
  const p: ExtractPorts = {
    prune: async () => 1,
    loadDue: async (afterId, limit) => due.filter((n) => afterId === null || n.id > afterId).slice(0, limit),
    save: async (n, lines) => {
      saved.push({ id: n.id, lines });
      const at = due.findIndex((d) => d.id === n.id);
      if (at >= 0) due.splice(at, 1);
    },
    model: async () => [{ kind: 'want', gist: 'walkable', quote: 'I want to live somewhere', entryDate: null }],
    ...overrides,
  };
  return { ports: p, saved };
}

describe('extractNoteLines', () => {
  it('prunes, then reads every due note and saves its lines', async () => {
    const { ports: p, saved } = ports([note('a'), note('b')]);
    const summary = await extractNoteLines({ ports: p, deadline: Date.now() + 60_000 });
    expect(summary).toEqual({ pruned: 1, read: 2, lines: 2, failed: 0, stopped: null });
    expect(saved.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('saves a note that gave no lines, so it is not sent again', async () => {
    const { ports: p, saved } = ports([note('a')], { model: async () => [] });
    await extractNoteLines({ ports: p, deadline: Date.now() + 60_000 });
    expect(saved).toEqual([{ id: 'a', lines: [] }]);
  });

  it('prunes without a key and says the model pass could not run', async () => {
    const prune = vi.fn(async () => 0);
    const { ports: p, saved } = ports([note('a')], { prune, model: undefined });
    const summary = await extractNoteLines({ ports: p, deadline: Date.now() + 60_000 });
    expect(prune).toHaveBeenCalledOnce();
    expect(summary.stopped).toBe('no-key');
    expect(saved).toEqual([]);
  });

  it('leaves a note it could not read due, and stops after repeated failures', async () => {
    const due = Array.from({ length: 12 }, (_, i) => note(`n${String(i).padStart(2, '0')}`));
    const { ports: p, saved } = ports(due, { model: async () => null });
    const summary = await extractNoteLines({ ports: p, deadline: Date.now() + 60_000 });
    expect(saved).toEqual([]);
    expect(summary.stopped).toBe('failures');
  });

  it('stops at the deadline', async () => {
    const { ports: p } = ports([note('a')], { now: () => 10 });
    const summary = await extractNoteLines({ ports: p, deadline: 5 });
    expect(summary.stopped).toBe('time');
    expect(summary.read).toBe(0);
  });

  it('records spend against the note owner', async () => {
    const ledger = vi.fn(async () => {});
    const { ports: p } = ports([note('a', { userId: 'owner' })], {
      ledger,
      model: async (_n, onSpend) => {
        onSpend({ model: 'm', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0 } });
        return [];
      },
    });
    await extractNoteLines({ ports: p, deadline: Date.now() + 60_000 });
    expect(ledger).toHaveBeenCalledWith('owner', expect.objectContaining({ model: 'm' }));
  });
});

describe('keepLines', () => {
  it('keeps quotes the note holds, ignoring markdown marks and spacing', () => {
    const kept = keepLines(
      [
        { kind: 'mood', quote: 'Woke up exhausted again,   running on fumes.', entry_date: '2026-10-02' },
        { kind: 'concept', gist: 'Socrates Mode', quote: 'I am at my best in Socrates Mode' },
      ],
      BODY,
      NOW,
    );
    expect(kept).toEqual([
      { kind: 'mood', gist: null, quote: 'Woke up exhausted again,   running on fumes.', entryDate: '2026-10-02' },
      { kind: 'concept', gist: 'Socrates Mode', quote: 'I am at my best in Socrates Mode', entryDate: null },
    ]);
  });

  it('drops a paraphrase, an unknown kind, an undated mood line and a repeat', () => {
    const kept = keepLines(
      [
        { kind: 'claim', quote: 'I do my best thinking by questioning' },
        { kind: 'fear', quote: 'I want to live somewhere' },
        { kind: 'mood', quote: 'Woke up exhausted again' },
        { kind: 'want', quote: 'I want to live somewhere' },
        { kind: 'want', quote: 'I want to live  somewhere' },
      ],
      BODY,
      NOW,
    );
    expect(kept.map((k) => k.kind)).toEqual(['want']);
  });

  it(`keeps at most ${MAX_LINES}`, () => {
    const body = Array.from({ length: 60 }, (_, i) => `I want thing number ${i}.`).join('\n');
    const raw = Array.from({ length: 60 }, (_, i) => ({ kind: 'want', quote: `I want thing number ${i}.` }));
    expect(keepLines(raw, body, NOW)).toHaveLength(MAX_LINES);
  });
});

describe('entryDate', () => {
  it('takes a real date up to tomorrow', () => {
    expect(entryDate('2024-02-29', NOW)).toBe('2024-02-29');
    expect(entryDate('2026-10-19', NOW)).toBe('2026-10-19');
  });

  it('refuses a date that does not exist, is in the future, is malformed or is too early', () => {
    expect(entryDate('2023-02-29', NOW)).toBeNull();
    expect(entryDate('2027-01-01', NOW)).toBeNull();
    expect(entryDate('Oct 2', NOW)).toBeNull();
    expect(entryDate('1970-01-01', NOW)).toBeNull();
    expect(entryDate(null, NOW)).toBeNull();
  });
});

describe('haikuForExtracts', () => {
  function client(input: unknown, stop_reason = 'tool_use') {
    return {
      messages: {
        create: vi.fn(async () => ({
          content: [{ type: 'tool_use', name: 'keep_lines', id: 't', input }],
          stop_reason,
          usage: { input_tokens: 10, output_tokens: 5 },
        })),
      },
    } as never;
  }

  it('reads the lines and keeps the ones the note holds', async () => {
    const model = haikuForExtracts(
      client({ lines: [{ kind: 'want', gist: 'walkable', quote: 'I want to live somewhere' }, { kind: 'claim', quote: 'made up' }] }),
      () => NOW,
    );
    const onSpend = vi.fn();
    expect(await model(note('a'), onSpend)).toEqual([
      { kind: 'want', gist: 'walkable', quote: 'I want to live somewhere', entryDate: null },
    ]);
    expect(onSpend).toHaveBeenCalledOnce();
  });

  it('returns null for an answer it cannot read or one cut off', async () => {
    expect(await haikuForExtracts(client({ lines: 'none' }))(note('a'), () => {})).toBeNull();
    expect(await haikuForExtracts(client({ lines: [] }, 'max_tokens'))(note('a'), () => {})).toBeNull();
  });
});
