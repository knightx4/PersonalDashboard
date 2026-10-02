import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  clock,
  extractVideoTakeaways,
  MAX_TAKEAWAYS,
  placeQuote,
  readTakeawayReply,
  secondsFrom,
  takeawayPrompt,
  TAKEAWAY_MODEL,
  timestampedTranscript,
} from './takeaways';

/** A fixed transcript: about two minutes of a video on working with an AI builder. */
const CUES = [
  { startSeconds: 0, endSeconds: 4, text: 'Welcome back to the channel.' },
  { startSeconds: 4, endSeconds: 12, text: 'Today I want to talk about how I plan work for my coding agent.' },
  { startSeconds: 31, endSeconds: 38, text: 'The first thing is I write the acceptance criteria before the agent starts,' },
  { startSeconds: 38, endSeconds: 44, text: 'so it knows exactly when the step is done.' },
  { startSeconds: 65, endSeconds: 72, text: 'Second, I keep a running log of every decision the agent made' },
  { startSeconds: 72, endSeconds: 80, text: 'and I read it back every morning.' },
  { startSeconds: 95, endSeconds: 101, text: 'This video is sponsored by a VPN.' },
];

const VISIONS = { app: 'One place for everything I keep track of.', dev: 'It should make working with an AI builder easy.' };
const VIDEO = { title: 'How I plan work for my agent', channel: 'Builder Notes', cues: CUES };

function stubClient(input: unknown) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'tool_use', name: 'report_takeaways', input }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 2_000, output_tokens: 300 },
  });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

describe('clock and secondsFrom', () => {
  it('writes and reads timestamps', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65)).toBe('1:05');
    expect(clock(3725)).toBe('1:02:05');
    expect(secondsFrom('1:05')).toBe(65);
    expect(secondsFrom('1:02:05')).toBe(3725);
    expect(secondsFrom(42.7)).toBe(42);
    expect(secondsFrom('42')).toBe(42);
    expect(secondsFrom('soon')).toBeNull();
    expect(secondsFrom(-3)).toBeNull();
  });
});

describe('timestampedTranscript', () => {
  it('starts a new timestamped line every half minute or so', () => {
    const { text, cut } = timestampedTranscript(CUES);
    expect(cut).toBe(false);
    expect(text.split('\n')).toEqual([
      '[0:00] Welcome back to the channel. Today I want to talk about how I plan work for my coding agent.',
      '[0:31] The first thing is I write the acceptance criteria before the agent starts, so it knows exactly when the step is done.',
      '[1:05] Second, I keep a running log of every decision the agent made and I read it back every morning.',
      '[1:35] This video is sponsored by a VPN.',
    ]);
  });

  it('cuts at a line end when the transcript is too long, and says so', () => {
    const { text, cut } = timestampedTranscript(CUES, 150);
    expect(cut).toBe(true);
    expect(text.split('\n')).toHaveLength(1);
  });
});

describe('takeawayPrompt', () => {
  it('gives the visions, the workspaces and the timestamped transcript', () => {
    const { prompt } = takeawayPrompt(VIDEO, VISIONS);
    expect(prompt).toContain('It should make working with an AI builder easy.');
    expect(prompt).toContain('One place for everything I keep track of.');
    expect(prompt).toContain('- dev: Dev.');
    expect(prompt).toContain('- learn: Learn.');
    expect(prompt).toContain('- app: the whole app');
    expect(prompt).toContain('Video: How I plan work for my agent');
    expect(prompt).toContain('[1:05] Second, I keep a running log');
  });

  it('says when a vision is not written', () => {
    expect(takeawayPrompt(VIDEO, { app: null, dev: null }).prompt).toContain('(not written yet)');
  });
});

describe('placeQuote', () => {
  it('places a quote at the cue its opening words are in', () => {
    expect(placeQuote(CUES, 'I keep a running log of every decision the agent made', null)).toBe(65);
  });

  it('finds a quote that runs across two cues', () => {
    expect(placeQuote(CUES, 'before the agent starts, so it knows exactly when', null)).toBe(31);
  });

  it('ignores case and punctuation', () => {
    expect(placeQuote(CUES, '"Second -- I KEEP a running log"', null)).toBe(65);
  });

  it('falls back to the claimed moment when the quote is paraphrased', () => {
    expect(placeQuote(CUES, 'Keep a diary of what the agent chose', 70)).toBe(70);
  });

  it('drops a claimed moment past the end of the video', () => {
    expect(placeQuote(CUES, 'Something never said here at all', 900)).toBeNull();
  });
});

describe('readTakeawayReply', () => {
  it('keeps what can be stored, placed and in a known workspace', () => {
    const takeaways = readTakeawayReply(
      {
        takeaways: [
          {
            title: 'Write acceptance criteria before a step starts',
            body: 'Every plan step would carry its done-when before a session claims it.',
            module: 'dev',
            quote: 'I write the acceptance criteria before the agent starts',
            at: '0:30',
          },
          { title: 'Log every decision', body: 'A daily log of what sessions chose.', module: 'nowhere', quote: '', at: '1:05' },
          { title: 'log every decision', body: 'The same point again.', module: 'dev', quote: '', at: '1:05' },
          { title: '', body: 'No title.', module: 'dev', quote: '', at: '0:00' },
        ],
      },
      CUES,
    );
    expect(takeaways).toEqual([
      {
        title: 'Write acceptance criteria before a step starts',
        body: 'Every plan step would carry its done-when before a session claims it.',
        module: 'dev',
        quote: 'I write the acceptance criteria before the agent starts',
        startSeconds: 31,
      },
      { title: 'Log every decision', body: 'A daily log of what sessions chose.', module: null, quote: '', startSeconds: 65 },
    ]);
  });

  it('keeps at most eight', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `Idea ${i}`, body: 'B.', module: 'app', quote: '', at: '0:00' }));
    expect(readTakeawayReply({ takeaways: many }, CUES)).toHaveLength(MAX_TAKEAWAYS);
  });

  it('reads an empty list as a video with nothing that applies', () => {
    expect(readTakeawayReply({ takeaways: [] }, CUES)).toEqual([]);
  });

  it('refuses a malformed reply', () => {
    expect(readTakeawayReply({ takeaways: 'none' }, CUES)).toBeNull();
  });
});

describe('extractVideoTakeaways', () => {
  it('sends the prompt to Sonnet, reports the spend and returns the takeaways', async () => {
    const { client, create } = stubClient({
      takeaways: [
        {
          title: 'Read the decision log each morning',
          body: 'Dash would show what sessions decided overnight.',
          module: 'dev',
          quote: 'and I read it back every morning',
          at: '1:12',
        },
      ],
    });
    const onSpend = vi.fn();
    const result = await extractVideoTakeaways({ video: VIDEO, visions: VISIONS, anthropicApiKey: 'k', client, onSpend });
    expect(result).toEqual({
      outcome: 'read',
      cut: false,
      takeaways: [
        {
          title: 'Read the decision log each morning',
          body: 'Dash would show what sessions decided overnight.',
          module: 'dev',
          quote: 'and I read it back every morning',
          startSeconds: 72,
        },
      ],
    });
    expect(create.mock.calls[0][0].model).toBe(TAKEAWAY_MODEL);
    expect(create.mock.calls[0][0].messages[0].content).toContain('[0:31] The first thing');
    expect(onSpend).toHaveBeenCalledWith(expect.objectContaining({ model: TAKEAWAY_MODEL }));
  });

  it('fails without a call when the transcript is empty', async () => {
    const { client, create } = stubClient({ takeaways: [] });
    const result = await extractVideoTakeaways({
      video: { ...VIDEO, cues: [{ startSeconds: 0, endSeconds: null, text: ' ' }] },
      visions: VISIONS,
      anthropicApiKey: 'k',
      client,
    });
    expect(result.outcome).toBe('failed');
    expect(create).not.toHaveBeenCalled();
  });

  it('says why when the call throws', async () => {
    const create = vi.fn().mockRejectedValue(new Error('overloaded'));
    const result = await extractVideoTakeaways({
      video: VIDEO,
      visions: VISIONS,
      anthropicApiKey: 'k',
      client: { messages: { create } } as unknown as Anthropic,
    });
    expect(result).toEqual({ outcome: 'failed', detail: 'overloaded' });
  });
});
