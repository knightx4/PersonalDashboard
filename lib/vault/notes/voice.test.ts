import { describe, expect, it, vi } from 'vitest';
import {
  haikuForVoice,
  tagNoteVoices,
  voicePrompt,
  type VoiceAnswer,
  type VoiceNote,
  type VoicePorts,
} from '@/lib/vault/notes/voice';

function note(id: string, extra: Partial<VoiceNote> = {}): VoiceNote {
  return {
    id,
    userId: 'u1',
    path: `Pending/${id}.md`,
    title: id,
    body: 'Some thinking of my own about cities and how they grow.',
    frontmatter: {},
    blobSha: `sha-${id}`,
    ...extra,
  };
}

function ports(due: VoiceNote[], overrides: Partial<VoicePorts> = {}) {
  const saved: Array<{ id: string; answer: VoiceAnswer }> = [];
  const p: VoicePorts = {
    tagByRule: async () => 3,
    loadDue: async (afterId, limit) =>
      due.filter((n) => afterId === null || n.id > afterId).slice(0, limit),
    save: async (n, answer) => {
      saved.push({ id: n.id, answer });
      const at = due.findIndex((d) => d.id === n.id);
      if (at >= 0) due.splice(at, 1);
    },
    model: async () => ({ voice: 'private', reason: 'Your own thinking.' }),
    ...overrides,
  };
  return { ports: p, saved };
}

describe('tagNoteVoices', () => {
  it('runs the rules, then asks the model about every note left', async () => {
    const { ports: p, saved } = ports([note('a'), note('b'), note('c')]);
    const summary = await tagNoteVoices({ ports: p, deadline: Date.now() + 60_000 });
    expect(summary).toEqual({ byRule: 3, byModel: 3, failed: 0, stopped: null });
    expect(saved.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('runs the rules without a key and says the model pass could not', async () => {
    const tagByRule = vi.fn(async () => 2);
    const { ports: p, saved } = ports([note('a')], { tagByRule, model: undefined });
    const summary = await tagNoteVoices({ ports: p, deadline: Date.now() + 60_000 });
    expect(tagByRule).toHaveBeenCalledOnce();
    expect(summary.stopped).toBe('no-key');
    expect(saved).toEqual([]);
  });

  it('leaves a note it could not read due, and stops after repeated failures', async () => {
    const due = Array.from({ length: 12 }, (_, i) => note(`n${String(i).padStart(2, '0')}`));
    const { ports: p, saved } = ports(due, { model: async () => null });
    const summary = await tagNoteVoices({ ports: p, deadline: Date.now() + 60_000 });
    expect(saved).toEqual([]);
    expect(summary.stopped).toBe('failures');
    expect(summary.failed).toBeGreaterThanOrEqual(5);
  });

  it('stops at the deadline', async () => {
    let t = 0;
    const { ports: p } = ports([note('a')], { now: () => t });
    t = 10;
    const summary = await tagNoteVoices({ ports: p, deadline: 5 });
    expect(summary.stopped).toBe('time');
    expect(summary.byModel).toBe(0);
  });

  it('records spend against the note owner', async () => {
    const ledger = vi.fn(async () => {});
    const { ports: p } = ports([note('a', { userId: 'owner' })], {
      ledger,
      model: async (_n, onSpend) => {
        onSpend({ model: 'm', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0 } });
        return { voice: 'audience', reason: 'Written for an employer.' };
      },
    });
    await tagNoteVoices({ ports: p, deadline: Date.now() + 60_000 });
    expect(ledger).toHaveBeenCalledWith('owner', expect.objectContaining({ model: 'm' }));
  });
});

describe('voicePrompt', () => {
  it('shows the folder, title, tags and the opening, never more than the sample', () => {
    const prompt = voicePrompt({
      path: 'Me/Journal.md',
      title: 'Journal',
      body: 'x'.repeat(5_000),
      frontmatter: { tags: ['daily', 3] },
    });
    expect(prompt).toContain('Folder: Me');
    expect(prompt).toContain('Title: Journal');
    expect(prompt).toContain('Tags: daily');
    expect(prompt.length).toBeLessThan(1_600);
  });

  it('names the top of the vault for a note with no folder', () => {
    expect(voicePrompt({ path: 'jung.md', title: 'jung', body: 'b', frontmatter: {} })).toContain(
      'Folder: (top of the vault)',
    );
  });
});

describe('haikuForVoice', () => {
  function client(input: unknown) {
    return {
      messages: {
        create: vi.fn(async () => ({
          content: [{ type: 'tool_use', name: 'tag_voice', id: 't', input }],
          usage: { input_tokens: 10, output_tokens: 5 },
        })),
      },
    } as never;
  }

  it('reads a voice and a reason', async () => {
    const model = haikuForVoice(client({ voice: 'clipped', reason: 'A pasted article.' }));
    const onSpend = vi.fn();
    expect(await model(note('a'), onSpend)).toEqual({ voice: 'clipped', reason: 'A pasted article.' });
    expect(onSpend).toHaveBeenCalledOnce();
  });

  it('returns null for an answer outside the five voices', async () => {
    const model = haikuForVoice(client({ voice: 'mine', reason: 'x' }));
    expect(await model(note('a'), () => {})).toBeNull();
  });
});
