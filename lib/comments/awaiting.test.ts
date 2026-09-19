import { describe, expect, it } from 'vitest';
import { REPLY_EXPECTED_MINUTES, awaitingDash } from './awaiting';
import type { CommentAuthor } from './load';

const written = '2026-09-17T02:00:00.000Z';
const at = (minutes: number) => new Date(written).getTime() + minutes * 60_000;

const turn = (author: CommentAuthor, body: string, createdAt = written) => ({
  author,
  body,
  createdAt,
});

describe('awaitingDash', () => {
  it('waits after a tagged comment nobody has answered', () => {
    expect(awaitingDash([turn('me', 'Can you look at this @dash')], 'step', at(1))).toBe(true);
  });

  it('does not wait on a note that asked nobody', () => {
    expect(awaitingDash([turn('me', 'A note to myself about this')], 'step', at(1))).toBe(false);
  });

  // #541: a raise is a question put to you, so the answer reaches Dash
  // whether or not it carries the tag.
  it('waits after anything written on a raise', () => {
    expect(awaitingDash([turn('me', 'Yes, do it.')], 'raise', at(1))).toBe(true);
    // The same words on a step are a note to yourself.
    expect(awaitingDash([turn('me', 'Yes, do it.')], 'step', at(1))).toBe(false);
  });

  it('stops the moment Dash has replied', () => {
    expect(
      awaitingDash(
        [turn('me', 'What about this @dash'), turn('claude', 'Here is what I found')],
        'step',
        at(1),
      ),
    ).toBe(false);
  });

  it('waits again when you write back under a reply', () => {
    expect(
      awaitingDash(
        [
          turn('me', 'What about this @dash'),
          turn('claude', 'Here is what I found'),
          turn('me', 'And the other one @dash', new Date(at(30)).toISOString()),
        ],
        'step',
        at(31),
      ),
    ).toBe(true);
  });

  it('gives up rather than promising a reply that is never coming', () => {
    expect(
      awaitingDash([turn('me', '@dash')], 'step', at(REPLY_EXPECTED_MINUTES - 1)),
    ).toBe(true);
    expect(awaitingDash([turn('me', '@dash')], 'step', at(REPLY_EXPECTED_MINUTES))).toBe(false);
  });

  it('claims nothing before the clock has mounted', () => {
    expect(awaitingDash([turn('me', '@dash')], 'step', 0)).toBe(false);
  });

  it('is false on a thread with nothing in it', () => {
    expect(awaitingDash([], 'step', at(1))).toBe(false);
    expect(awaitingDash([], 'raise', at(1))).toBe(false);
  });
});
