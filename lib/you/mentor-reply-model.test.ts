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

  it('cuts a long line', () => {
    const cut = cleanAck('x'.repeat(400))!;
    expect(cut.length).toBe(ACK_MAX_CHARS);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('replyFailed', () => {
  it('names the mentor and the reason', () => {
    expect(replyFailed('Ada', 'the model could not be reached.')).toBe(
      'Ada could not reply just now: the model could not be reached. Send it again to try once more.',
    );
  });
});
