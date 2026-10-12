import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { CLIP_NOTE_MODEL, clipNotePrompt, MAX_CLIP_TEXT, readClipNote, writeClipNote } from './clip-note';
import { notesDue } from './clip-note-run';
import { clipNoteFor } from './load';

/**
 * "In this video" on a Learn now card (note cde86a10), with the model stubbed.
 */

const input = {
  idea: 'Price ceilings make shortages',
  claim: 'A cap below the market price leaves more buyers than sellers.',
  video: 'Price controls and the shortages they make',
  text: 'So if the government says   rent can be no higher\nthan this, what happens to the queue?',
};

function stubClient(content: unknown[]) {
  const sent: { model: string; messages: { content: string }[] }[] = [];
  const client = {
    messages: {
      create: async (params: (typeof sent)[number]) => {
        sent.push(params);
        return { content, stop_reason: 'tool_use', usage: { input_tokens: 1_500, output_tokens: 90 } };
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

describe('the prompt', () => {
  it("names the card's idea and claim, the video, and the transcript flattened", () => {
    const prompt = clipNotePrompt(input);
    expect(prompt).toContain("The card's idea: Price ceilings make shortages");
    expect(prompt).toContain('What the card says about it: A cap below');
    expect(prompt).toContain('The video: Price controls and the shortages they make');
    expect(prompt).toContain('So if the government says rent can be no higher than this,');
  });

  it('leaves out an empty claim and cuts a long transcript', () => {
    const prompt = clipNotePrompt({ ...input, claim: ' ', text: 'word '.repeat(5_000) });
    expect(prompt).not.toContain('What the card says');
    expect(prompt.length).toBeLessThan(MAX_CLIP_TEXT + 400);
  });
});

describe('reading the note', () => {
  it('keeps both sentences, flattened', () => {
    expect(readClipNote({ said: ' Caps  make queues. ', why: 'It is the same diagram.' })).toEqual({
      said: 'Caps make queues.',
      why: 'It is the same diagram.',
    });
  });

  it('refuses a note missing either sentence', () => {
    expect(readClipNote({ said: 'Caps make queues.', why: '  ' })).toBe('The note came back empty.');
    expect(readClipNote({ said: 'Caps make queues.' })).toBe('The note did not match its schema.');
  });

  it('cuts a runaway sentence at a sentence end', () => {
    const said = `${'First point here. '.repeat(30)}`;
    const read = readClipNote({ said, why: 'Fits.' });
    expect(typeof read === 'object' && read.said.length <= 300 && read.said.endsWith('.')).toBe(true);
  });
});

describe('writing the note', () => {
  it('reports the spend and returns the two sentences', async () => {
    const { client, sent } = stubClient([
      { type: 'tool_use', name: 'describe_clip', input: { said: 'Caps make queues.', why: 'Same diagram.' } },
    ]);
    const spend: SpendReport[] = [];
    const result = await writeClipNote({ ...input, anthropicApiKey: 'unused', client, onSpend: (r) => spend.push(r) });
    expect(result).toEqual({ ok: true, said: 'Caps make queues.', why: 'Same diagram.' });
    expect(sent[0].model).toBe(CLIP_NOTE_MODEL);
    expect(spend).toHaveLength(1);
  });

  it('says why when the call fails', async () => {
    const failing = {
      messages: {
        create: async () => {
          throw new Error('overloaded');
        },
      },
    } as unknown as Anthropic;
    expect(await writeClipNote({ ...input, anthropicApiKey: 'unused', client: failing })).toEqual({
      ok: false,
      detail: 'overloaded',
    });
  });
});

const card = (id: string, concept: string, noted: string | null = null) => ({
  id,
  concept_id: concept,
  idea_name: id,
  takeaway: null,
  summary: null,
  named_article: null,
  clip_note_segment_id: noted,
});

describe('which cards are due a note', () => {
  const matches = [
    { concept_id: 'c1', segment_id: 's1', item_title: 'Lecture one' },
    { concept_id: 'c2', segment_id: 's2', item_title: 'Lecture two' },
  ];

  it('takes cards with a clip and no note on it, and leaves cards with no clip', () => {
    const due = notesDue([card('a', 'c1'), card('b', 'c3'), card('c', 'c2', 's2')], matches, 8);
    expect(due.map((entry) => [entry.card.id, entry.segmentId, entry.video])).toEqual([['a', 's1', 'Lecture one']]);
  });

  it('writes again when a closer clip replaced the one the note was about, up to the limit', () => {
    const due = notesDue([card('a', 'c1', 'old'), card('b', 'c2')], matches, 1);
    expect(due.map((entry) => entry.card.id)).toEqual(['a']);
  });
});

describe('the note shown on a dealt card', () => {
  const stored = { segmentId: 's1', said: 'Caps make queues.', why: 'Same diagram.' };

  it('is the stored note while the same clip plays', () => {
    expect(clipNoteFor(stored, 's1')).toEqual({ said: 'Caps make queues.', why: 'Same diagram.' });
  });

  it('is none once another clip plays, or when none was written', () => {
    expect(clipNoteFor(stored, 's2')).toBeNull();
    expect(clipNoteFor(undefined, 's1')).toBeNull();
  });
});
