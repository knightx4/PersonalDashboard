import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  RATING_AXES,
  RATING_QUESTIONS,
  rateClipsFor,
  ratingFromJev,
  ratingFromLevel,
  ratingState,
  readHaikuReply,
} from './rate-jev';
import type { ClipToScore } from './score-jev';

/**
 * Rating clips on educational value, entertainment and quality. Jev is a
 * stubbed fetch answering by caption, or failing where it has no answer;
 * Haiku is a stubbed client.
 */

type Weighted = Record<'educational' | 'entertainment' | 'quality', number>;

function jevByCaption(byCaption: Record<string, Weighted>) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)) as { state: { clip: { caption: string } } };
    const scores = byCaption[sent.state.clip.caption];
    if (!scores) return new Response('overloaded', { status: 529 });
    const answers = Object.fromEntries(
      Object.entries(scores).map(([axis, score]) => [axis, { type: 'score', score, confidence: 0.6, probabilities: {} }]),
    );
    return new Response(
      JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 400, output_tokens: 0 } }),
    );
  }) as unknown as typeof fetch;
}

function haikuRatings(ratings: Record<string, number>[]) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'tool_use', name: 'report_clip_ratings', input: { ratings } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 2_000, output_tokens: 80 },
  });
  return { client: { messages: { create } } as unknown as Pick<Anthropic, 'messages'>, create };
}

const clip = (id: string, caption: string): ClipToScore => ({
  id,
  caption,
  idea: 'A point the cutter wrote.',
  serves: 'Startup Finance',
  title: `Video for ${caption}`,
  channel: 'A channel',
  transcript: `The words of ${caption}.`,
});

describe('the questions', () => {
  it('asks three score questions of five levels each', () => {
    expect(RATING_AXES).toEqual(['educational', 'entertainment', 'quality']);
    for (const axis of RATING_AXES) expect(RATING_QUESTIONS[axis].levels).toHaveLength(5);
  });

  it('reads the title and transcript, and nothing about the learner', () => {
    const state = ratingState(clip('a', 'cash'));
    expect(state).toEqual({
      clip: { video: 'Video for cash', channel: 'A channel', caption: 'cash', transcript: 'The words of cash.' },
    });
  });

  it('spreads the levels over 1 to 100', () => {
    expect(ratingFromJev(0)).toBe(1);
    expect(ratingFromJev(4)).toBe(100);
    expect(ratingFromJev(2)).toBe(51);
    expect(ratingFromLevel(1)).toBe(1);
    expect(ratingFromLevel(5)).toBe(100);
  });

  it('drops a Haiku row missing an axis or out of range', () => {
    const reply = readHaikuReply(
      {
        ratings: [
          { number: 1, educational: 4, entertainment: 2, quality: 3 },
          { number: 2, educational: 4, entertainment: 2 },
          { number: 3, educational: 6, entertainment: 2, quality: 3 },
          { number: 9, educational: 1, entertainment: 1, quality: 1 },
        ],
      },
      3,
    );
    expect([...reply.keys()]).toEqual([1]);
  });
});

describe('rateClipsFor', () => {
  it('rates with Jev and combines the three', async () => {
    const jevFetch = jevByCaption({ cash: { educational: 4, entertainment: 2, quality: 3 } });
    const result = await rateClipsFor({
      clips: [clip('a', 'cash')],
      jevEnabled: true,
      client: null,
      jevApiKey: 'key',
      jevFetch,
    });
    expect(result.ratings).toEqual([
      { id: 'a', educational: 100, entertainment: 51, quality: 75, rating: 75, by: 'jev' },
    ]);
    expect(result.unrated).toEqual([]);
    expect(jevFetch).toHaveBeenCalledTimes(1);
  });

  it('sends what Jev could not rate to Haiku', async () => {
    const jevFetch = jevByCaption({ cash: { educational: 2, entertainment: 2, quality: 2 } });
    const { client, create } = haikuRatings([{ number: 1, educational: 5, entertainment: 1, quality: 3 }]);
    const result = await rateClipsFor({
      clips: [clip('a', 'cash'), clip('b', 'unknown')],
      jevEnabled: true,
      client,
      jevApiKey: 'key',
      jevFetch,
    });
    expect(result.ratings.map((r) => [r.id, r.by])).toEqual([
      ['a', 'jev'],
      ['b', 'haiku'],
    ]);
    expect(result.ratings[1]).toMatchObject({ educational: 100, entertainment: 1, quality: 51, rating: 51 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('never asks Jev for an account that has not opted in', async () => {
    const jevFetch = jevByCaption({ cash: { educational: 4, entertainment: 4, quality: 4 } });
    const { client } = haikuRatings([{ number: 1, educational: 3, entertainment: 3, quality: 3 }]);
    const result = await rateClipsFor({ clips: [clip('a', 'cash')], jevEnabled: false, client, jevApiKey: 'key', jevFetch });
    expect(jevFetch).not.toHaveBeenCalled();
    expect(result.ratings[0]).toMatchObject({ id: 'a', by: 'haiku', rating: 51 });
  });

  it('leaves a clip unrated when neither model can rate it', async () => {
    const result = await rateClipsFor({
      clips: [clip('a', 'unknown')],
      jevEnabled: true,
      client: null,
      jevApiKey: 'key',
      jevFetch: jevByCaption({}),
    });
    expect(result).toEqual({ ratings: [], unrated: ['a'], failed: 0 });
  });
});
