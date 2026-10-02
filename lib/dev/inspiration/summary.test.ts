import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { MAX_POINTS, readSummaryReply, summariseVideos, type SummaryStore } from './summary';

const USER = 'user-1';
const CUES = [{ startSeconds: 0, endSeconds: 10, text: 'Write the acceptance criteria before the agent starts.' }];

function client(points: unknown): Pick<Anthropic, 'messages'> {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', name: 'report_summary', input: { points } }],
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    },
  } as unknown as Pick<Anthropic, 'messages'>;
}

describe('readSummaryReply', () => {
  it('trims, drops empty points and keeps at most five', () => {
    const many = Array.from({ length: 8 }, (_, i) => ` point  ${i} `);
    expect(readSummaryReply({ points: ['', ...many] })).toEqual(
      Array.from({ length: MAX_POINTS }, (_, i) => `point ${i}`),
    );
  });

  it('is null when nothing usable came back', () => {
    expect(readSummaryReply({ points: ['  '] })).toBeNull();
    expect(readSummaryReply({ points: 'one' })).toBeNull();
  });
});

describe('summariseVideos', () => {
  function store(): SummaryStore & { saved: Map<string, string[]> } {
    const saved = new Map<string, string[]>();
    return {
      saved,
      unsummarisedVideos: async () => [
        { id: 'v1', videoId: 'aaaaaaaaaaa', title: 'One' },
        { id: 'v2', videoId: 'bbbbbbbbbbb', title: 'Two' },
      ],
      saveSummary: async (_userId, id, points) => void saved.set(id, points),
    };
  }

  it('saves the points for each video with a transcript', async () => {
    const memory = store();
    const loadCues = vi.fn(async (videoId: string) => (videoId === 'aaaaaaaaaaa' ? { cues: CUES } : null));
    const onSpend = vi.fn();
    const done = await summariseVideos(memory, loadCues, USER, { client: client(['Criteria come first.']), onSpend });
    expect(done).toBe(1);
    expect(memory.saved.get('v1')).toEqual(['Criteria come first.']);
    expect(memory.saved.has('v2')).toBe(false);
    expect(onSpend).toHaveBeenCalledTimes(1);
  });

  it('leaves a video unsummarised when the model gives nothing, so the next run tries again', async () => {
    const memory = store();
    const done = await summariseVideos(memory, async () => ({ cues: CUES }), USER, { client: client([]) });
    expect(done).toBe(0);
    expect(memory.saved.size).toBe(0);
  });

  it('starts nothing past the deadline', async () => {
    const memory = store();
    const loadCues = vi.fn();
    await summariseVideos(memory, loadCues, USER, { client: client(['x']), deadline: 0 });
    expect(loadCues).not.toHaveBeenCalled();
  });
});
