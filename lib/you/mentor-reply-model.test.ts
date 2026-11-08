import { describe, expect, it } from 'vitest';
import { ACK_MAX_CHARS, bubblePauseMs, cleanAck, MAX_BUBBLES, plainBubble, replyFailed, splitBubbles, wholeBubbles } from './mentor-reply-model';

describe('plainBubble', () => {
  it('takes headings, bullets, numbers and bold off a bubble, keeping the words', () => {
    expect(plainBubble('## Where things are\n- **Two** builds running\n* one waiting\n1. Ship it')).toBe(
      'Where things are\nTwo builds running\none waiting\nShip it',
    );
  });

  it('leaves an ordinary text alone', () => {
    expect(plainBubble('Then take it. #2854.3 is the one to look at, and 5 - 3 is 2.')).toBe(
      'Then take it. #2854.3 is the one to look at, and 5 - 3 is 2.',
    );
  });

  it('is applied when a reply is split', () => {
    expect(splitBubbles('# Yes\n\n- six weeks first')).toEqual(['Yes', 'six weeks first']);
  });
});

describe('splitBubbles', () => {
  it('splits on blank lines and drops empty parts', () => {
    expect(splitBubbles('Yes.\n\nSix weeks of cash first.\n \n\nThen apply.')).toEqual(['Yes.', 'Six weeks of cash first.', 'Then apply.']);
  });

  it('keeps a single line break inside a bubble', () => {
    expect(splitBubbles('One\ntwo')).toEqual(['One\ntwo']);
  });

  it('joins anything past the cap into the last bubble', () => {
    const parts = Array.from({ length: MAX_BUBBLES + 2 }, (_, i) => `p${i}`);
    const bubbles = splitBubbles(parts.join('\n\n'));
    expect(bubbles).toHaveLength(MAX_BUBBLES);
    expect(bubbles.at(-1)).toBe(parts.slice(MAX_BUBBLES - 1).join('\n\n'));
  });
});

describe('wholeBubbles', () => {
  it('holds back the part still being written', () => {
    expect(wholeBubbles('Yes.')).toEqual([]);
    expect(wholeBubbles('Yes.\n\nSix we')).toEqual(['Yes.']);
    expect(wholeBubbles('Yes.\n\nSix weeks.\n\n')).toEqual(['Yes.', 'Six weeks.']);
  });

  it('agrees with the finished split on every bubble it releases', () => {
    const full = 'a\n\nb\n\nc\n\nd\n\ne\n\nf\n\ng';
    for (let i = 0; i <= full.length; i++) {
      const whole = wholeBubbles(full.slice(0, i));
      expect(splitBubbles(full).slice(0, whole.length)).toEqual(whole);
    }
  });
});

describe('bubblePauseMs', () => {
  it('grows with length between its floor and ceiling', () => {
    expect(bubblePauseMs('ok')).toBe(800);
    expect(bubblePauseMs('x'.repeat(40))).toBe(1_600);
    expect(bubblePauseMs('x'.repeat(1_000))).toBe(3_500);
  });
});

describe('cleanAck', () => {
  it('keeps the first line without wrapping quotes', () => {
    expect(cleanAck('\n"Ha, fair question."\nSecond line')).toBe('Ha, fair question.');
  });

  it('is null for nothing usable', () => {
    expect(cleanAck('  \n ')).toBeNull();
    expect(cleanAck('""')).toBeNull();
  });

  // The first texts of 6 and 8 November 2026 (plan #3067), as the model wrote them past the limit.
  const LONG_ACKS = [
    "Hopes and fears is a good place to start, and I can help you get at them. Let's begin with the fear. What's the one you'd least want to say out loud about your future?",
    'Better, but it\'s still a claim about AI rather than evidence of you doing it. Every implementation candidate will say they want to reshape processes. The interviewer wants a story.',
  ];

  it('keeps the whole sentences of a long line, never part of a word', () => {
    expect(cleanAck(LONG_ACKS[0])).toBe(
      'Hopes and fears is a good place to start, and I can help you get at them. Let\'s begin with the fear.',
    );
    expect(cleanAck(LONG_ACKS[1])).toBe(
      'Better, but it\'s still a claim about AI rather than evidence of you doing it. Every implementation candidate will say they want to reshape processes.',
    );
    for (const text of LONG_ACKS) {
      const kept = cleanAck(text)!;
      expect(kept.length).toBeLessThanOrEqual(ACK_MAX_CHARS);
      expect(kept).toMatch(/[.!?]$/);
      expect(text.startsWith(kept)).toBe(true);
    }
  });

  it('drops the unfinished sentence of a text stopped at its token cap', () => {
    expect(cleanAck('Fair point. Let me think about the inter', true)).toBe('Fair point.');
    expect(cleanAck('Ha, fair question.', true)).toBe('Ha, fair question.');
  });

  it('is null when no whole sentence fits', () => {
    expect(cleanAck('x'.repeat(400))).toBeNull();
    expect(cleanAck('Let me think about the inter', true)).toBeNull();
  });
});

describe('replyFailed', () => {
  it('names the mentor and the reason', () => {
    expect(replyFailed('Ada', 'the model could not be reached.')).toBe(
      'Ada could not reply just now: the model could not be reached. Send it again to try once more.',
    );
  });
});
