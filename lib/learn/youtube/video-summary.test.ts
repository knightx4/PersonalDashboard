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

const video = { title: 'How tides work', channel: 'Sixty Symbols', description: 'The Moon pulls on both sides of the Earth.', transcript: null };

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
  it('says there is no transcript when it sends the description', () => {
    expect(summaryPrompt(video)).toContain('Description (there is no transcript yet):');
  });

  it('sends the transcript and not the description when there is one', () => {
    const prompt = summaryPrompt({ ...video, transcript: 'Tides are two bulges.' });
    expect(prompt).toContain('Transcript:\nTides are two bulges.');
    expect(prompt).not.toContain('Description');
  });
});

describe('readSummaryReply', () => {
  it('keeps at most five points and drops blank ones', () => {
    const reply = readSummaryReply({ summary: ' S. ', key_points: ['a', ' ', 'b', 'c', 'd', 'e', 'f'] }, 'transcript');
    expect(reply).toEqual({ outcome: 'written', from: 'transcript', summary: 'S.', keyPoints: ['a', 'b', 'c', 'd', 'e'] });
  });

  it('takes too_little only for a description', () => {
    expect(readSummaryReply({ summary: '', key_points: [], too_little: true }, 'description').outcome).toBe('too-little');
    expect(readSummaryReply({ summary: '', key_points: [], too_little: true }, 'transcript').outcome).toBe('failed');
  });
});

describe('writeVideoSummary', () => {
  it('writes from the description and reports the spend', async () => {
    const { client, create } = stubClient({ summary: 'The Moon raises two bulges.', key_points: ['Two tides a day.'] });
    const onSpend = vi.fn();
    const result = await writeVideoSummary({ video, anthropicApiKey: 'k', client, onSpend });
    expect(result).toEqual({ outcome: 'written', from: 'description', summary: 'The Moon raises two bulges.', keyPoints: ['Two tides a day.'] });
    expect(create.mock.calls[0][0].model).toBe(VIDEO_SUMMARY_MODEL);
    expect(onSpend).toHaveBeenCalledWith(expect.objectContaining({ model: VIDEO_SUMMARY_MODEL }));
  });

  it('marks it written from the transcript when there is one', async () => {
    const { client } = stubClient({ summary: 'S.', key_points: [] });
    const result = await writeVideoSummary({ video: { ...video, transcript: 'T.' }, anthropicApiKey: 'k', client });
    expect(result).toMatchObject({ outcome: 'written', from: 'transcript' });
  });

  it('makes no call for an empty description and no transcript', async () => {
    const { client, create } = stubClient({});
    const result = await writeVideoSummary({ video: { ...video, description: '  ' }, anthropicApiKey: 'k', client });
    expect(result).toEqual({ outcome: 'too-little', from: 'description' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('needsSummary', () => {
  it('asks for one when there is none yet', () => {
    expect(needsSummary({ summary_from: null, summarised_at: null }, false)).toBe(true);
  });

  it('asks again from the transcript once one is stored', () => {
    expect(needsSummary({ summary_from: 'description', summarised_at: '2026-09-26' }, true)).toBe(true);
    expect(needsSummary({ summary_from: null, summarised_at: '2026-09-26' }, true)).toBe(true);
  });

  it('leaves a description summary alone while there is no transcript, and a transcript one always', () => {
    expect(needsSummary({ summary_from: 'description', summarised_at: '2026-09-26' }, false)).toBe(false);
    expect(needsSummary({ summary_from: 'transcript', summarised_at: '2026-09-26' }, true)).toBe(false);
  });
});
