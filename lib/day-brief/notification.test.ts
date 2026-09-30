import { describe, expect, it } from 'vitest';
import { BODY_MAX, checkNotification, clip, NO_PICKS, picksPrompt, plainNotification, TITLE_MAX } from './notification';
import type { DayBriefPick } from './picks';

function pick(key: string, title: string, reason: string): DayBriefPick {
  return { key, kind: 'reply', title, reason, href: '/todo' };
}

const INTERVIEW = pick('interview:i1', 'Respark hiring screen', 'Interview today at 10:30 AM (with Dana)');
const BILL = pick('bill:b1', 'Car loan', '$312.50 due today');
const STEP = pick('goal-step:s1', 'Choose a moving date', '5 Dash steps wait on this');

describe('plainNotification', () => {
  it('names the first pick in the title and the others with their reasons in the body', () => {
    expect(plainNotification([INTERVIEW, BILL, STEP])).toEqual({
      title: 'Respark hiring screen',
      body: 'Interview today at 10:30 AM (with Dana). Car loan: $312.50 due today. Choose a moving date: 5 Dash steps wait on this.',
    });
  });

  it('names a pick without its reason when the reason does not fit, and stays within the lock screen', () => {
    const long = pick('reply:r1', 'Reply to Maya', 'Waiting on your reply '.repeat(8).trim());
    const note = plainNotification([pick('a', 'x'.repeat(70), 'y '.repeat(60).trim()), long, BILL]);
    expect(note.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(note.body.length).toBeLessThanOrEqual(BODY_MAX);
    expect(note.body).toContain('Reply to Maya.');
  });

  it('is the no-picks note with nothing to name', () => {
    expect(plainNotification([])).toBe(NO_PICKS);
  });
});

describe('checkNotification', () => {
  it('keeps a notification that uses only the figures the picks carry', () => {
    expect(
      checkNotification(
        { title: 'Respark hiring screen.', body: 'At 10:30 with Dana — and $312.50 is due on the car loan!' },
        [INTERVIEW, BILL],
      ),
    ).toEqual({ title: 'Respark hiring screen', body: 'At 10:30 with Dana, and $312.50 is due on the car loan.' });
  });

  it('refuses one that is too long, empty, or carries a figure of its own', () => {
    expect(checkNotification({ title: 'a'.repeat(TITLE_MAX + 1), body: 'Fine.' }, [INTERVIEW])).toBeNull();
    expect(checkNotification({ title: 'Fine', body: 'b'.repeat(BODY_MAX + 1) }, [INTERVIEW])).toBeNull();
    expect(checkNotification({ title: ' ', body: 'Fine.' }, [INTERVIEW])).toBeNull();
    expect(checkNotification({ title: 'Respark', body: 'At 11:00 with Dana.' }, [INTERVIEW])).toBeNull();
  });
});

describe('clip', () => {
  it('cuts at a word and marks the cut', () => {
    expect(clip('Price the sofa and the rug', 16)).toBe('Price the sofa…');
    expect(clip('Short', 16)).toBe('Short');
  });
});

describe('picksPrompt', () => {
  it('lists the picks in order with their reasons', () => {
    expect(picksPrompt('2026-09-28', [INTERVIEW, BILL])).toBe(
      [
        'Today is 2026-09-28.',
        '',
        "Today's picks, most important first:",
        '1. Respark hiring screen. Why: Interview today at 10:30 AM (with Dana)',
        '2. Car loan. Why: $312.50 due today',
      ].join('\n'),
    );
  });
});
