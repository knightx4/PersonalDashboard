import { describe, expect, it } from 'vitest';
import { firstLine, isQuietHours, localHour, textPayload, unreadTextsOf } from './council-texts';

describe('quiet hours', () => {
  it('runs from 22:00 to 08:00 in the person\'s zone', () => {
    const ny = 'America/New_York';
    // 3 November 2026 is after the clocks went back: New York is UTC-5.
    expect(isQuietHours(new Date('2026-11-04T02:59:00Z'), ny)).toBe(false); // 21:59
    expect(isQuietHours(new Date('2026-11-04T03:00:00Z'), ny)).toBe(true); // 22:00
    expect(isQuietHours(new Date('2026-11-04T12:59:00Z'), ny)).toBe(true); // 07:59
    expect(isQuietHours(new Date('2026-11-04T13:00:00Z'), ny)).toBe(false); // 08:00
    // The daily cron's 12:00 UTC is 07:00 in New York in winter.
    expect(isQuietHours(new Date('2026-11-04T12:00:00Z'), ny)).toBe(true);
  });

  it('reads an unknown or empty zone as UTC', () => {
    expect(localHour(new Date('2026-11-04T09:30:00Z'), 'Mars/Olympus')).toBe(9);
    expect(localHour(new Date('2026-11-04T23:30:00Z'), '')).toBe(23);
    expect(isQuietHours(new Date('2026-11-04T23:30:00Z'), 'nowhere')).toBe(true);
  });
});

describe('unread texts', () => {
  const threads = [
    { id: 'c1', advisorId: 'a1', lastReadAt: '2026-11-03T10:00:00Z' },
    { id: 'c2', advisorId: 'a2', lastReadAt: null },
  ];

  it('counts a text unread until it is read or the thread is opened after it', () => {
    const out = unreadTextsOf(threads, [
      { chatId: 'c1', createdAt: '2026-11-03T09:00:00Z', readAt: null }, // before the thread was opened
      { chatId: 'c1', createdAt: '2026-11-03T11:00:00Z', readAt: null },
      { chatId: 'c2', createdAt: '2026-11-03T09:00:00Z', readAt: '2026-11-03T09:05:00Z' },
      { chatId: 'c2', createdAt: '2026-11-03T12:00:00Z', readAt: null },
      { chatId: 'gone', createdAt: '2026-11-03T12:00:00Z', readAt: null },
    ]);
    expect(out).toEqual([
      { advisorId: 'a1', createdAt: '2026-11-03T11:00:00Z' },
      { advisorId: 'a2', createdAt: '2026-11-03T12:00:00Z' },
    ]);
  });
});

describe('the notification for a text', () => {
  it('names the mentor over the first line, and opens Chat', () => {
    expect(
      textPayload({
        messageId: 'm1',
        mentorName: 'Jerwyn the Elder',
        text: '\n  You said Friday for the  Brex email.\nHow did it go?',
      }),
    ).toEqual({
      title: 'Jerwyn the Elder',
      body: 'You said Friday for the Brex email.',
      url: '/chat',
      tag: 'council-text-m1',
    });
  });

  it('keeps each text its own notification, and never sends an empty one', () => {
    const a = textPayload({ messageId: 'a', mentorName: '', text: '   ' });
    const b = textPayload({ messageId: 'b', mentorName: 'CFO', text: 'x' });
    expect(a.title).toBe('Your council');
    expect(a.body).toBe('Sent you a text.');
    expect(a.tag).not.toBe(b.tag);
  });

  it('clips a long first line to what a lock screen shows', () => {
    const body = textPayload({ messageId: 'm', mentorName: 'Seneca', text: 'word '.repeat(100) }).body;
    expect(body.length).toBeLessThanOrEqual(180);
    expect(firstLine('one\ntwo')).toBe('one');
  });
});
