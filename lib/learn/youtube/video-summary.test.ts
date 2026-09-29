import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { needsSummary } from './summaries';
import { readSummaryReply, summaryPrompt, transcriptText, writeVideoSummary, VIDEO_SUMMARY_MODEL } from './video-summary';

const cue = (text: string, startSeconds = 0) => ({ startSeconds, endSeconds: null, text });

function stubClient(input: unknown) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'tool_use', name: 'report_summary', input }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 900, output_tokens: 200 },
  });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const video = { title: 'How tides work', channel: 'Sixty Symbols', durationSeconds: 600, transcript: 'The Moon pulls on both sides of the Earth.' };

describe('transcriptText', () => {
  it('joins the cues into one text', () => {
    expect(transcriptText([cue(' The Moon '), cue('pulls.\n')])).toBe('The Moon pulls.');
  });

  it('cuts a long transcript at a sentence end near the limit', () => {
    const text = transcriptText([cue('One two three. Four five six. Seven eight nine.')], 34);
    expect(text).toBe('One two three. Four five six.');
  });
});

describe('summaryPrompt', () => {
  it('sends the transcript and the length, never a description', () => {
    const prompt = summaryPrompt({ ...video, transcript: 'Tides are two bulges.' });
    expect(prompt).toContain('Transcript:\nTides are two bulges.');
    expect(prompt).toContain('Length: 10 minutes');
    expect(prompt).not.toContain('Description');
  });
});

describe('readSummaryReply', () => {
  it('keeps at most twelve takeaways and drops blank ones', () => {
    const points = Array.from({ length: 14 }, (_, i) => `p${i}`);
    const reply = readSummaryReply({ summary: ' S. ', key_points: [' ', ...points] });
    expect(reply).toEqual({ outcome: 'written', summary: 'S.', keyPoints: points.slice(0, 12) });
  });

  it('takes too_little for a transcript with nothing to say', () => {
    expect(readSummaryReply({ summary: '', key_points: [], too_little: true }).outcome).toBe('too-little');
  });
});

describe('writeVideoSummary', () => {
  it('writes from the transcript and reports the spend', async () => {
    const { client, create } = stubClient({ summary: 'The Moon raises two bulges.', key_points: ['Two tides a day.'] });
    const onSpend = vi.fn();
    const result = await writeVideoSummary({ video, anthropicApiKey: 'k', client, onSpend });
    expect(result).toEqual({ outcome: 'written', summary: 'The Moon raises two bulges.', keyPoints: ['Two tides a day.'] });
    expect(create.mock.calls[0][0].model).toBe(VIDEO_SUMMARY_MODEL);
    expect(onSpend).toHaveBeenCalledWith(expect.objectContaining({ model: VIDEO_SUMMARY_MODEL }));
  });

  it('makes no call for an empty transcript', async () => {
    const { client, create } = stubClient({});
    const result = await writeVideoSummary({ video: { ...video, transcript: '  ' }, anthropicApiKey: 'k', client });
    expect(result).toEqual({ outcome: 'too-little' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('needsSummary', () => {
  const since = '2026-09-29T21:00:00Z';

  it('never asks without a transcript', () => {
    expect(needsSummary({ summary_from: null, summarised_at: null }, false, since)).toBe(false);
  });

  it('asks once a transcript is stored and there is none, or one from the description', () => {
    expect(needsSummary({ summary_from: null, summarised_at: null }, true, since)).toBe(true);
    expect(needsSummary({ summary_from: 'description', summarised_at: '2026-09-30' }, true, since)).toBe(true);
  });

  it('rewrites a transcript summary written to an older prompt, and leaves a current one', () => {
    expect(needsSummary({ summary_from: 'transcript', summarised_at: '2026-09-26' }, true, since)).toBe(true);
    expect(needsSummary({ summary_from: 'transcript', summarised_at: '2026-09-30' }, true, since)).toBe(false);
  });
});
