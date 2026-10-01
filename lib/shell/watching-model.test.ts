import { describe, expect, it } from 'vitest';
import {
  endedUpdate,
  endsLabel,
  hearLabel,
  reportTimeLabel,
  watchDirection,
  type EndedWatch,
} from './watching-model';

describe('watchDirection', () => {
  it('says which way the price has gone since the watch started', () => {
    expect(watchDirection(210, 186, 'USD', 5)).toEqual({ text: 'Down $24 since it started', tone: 'down' });
    expect(watchDirection(186, 198.5, 'USD', 5)).toEqual({ text: 'Up $12.50 since it started', tone: 'up' });
    expect(watchDirection(186, 186, 'EUR', 3)?.text).toBe('No change since it started');
  });

  it('says nothing until there are two values', () => {
    expect(watchDirection(186, 186, 'USD', 1)).toBeNull();
    expect(watchDirection(null, null, 'USD', 0)).toBeNull();
  });
});

describe('hearLabel', () => {
  it('names the push line and the report times, in order', () => {
    expect(hearLabel({ below: 200, currency: 'USD', reportTimes: ['18:00:00', '09:00:00'] })).toBe(
      'Push under $200, report at 9:00 AM and 6:00 PM',
    );
  });

  it('reads a report-only watch and one with neither', () => {
    expect(hearLabel({ below: null, currency: 'USD', reportTimes: ['00:30'] })).toBe('Report at 12:30 AM');
    expect(hearLabel({ below: null, currency: 'USD', reportTimes: [] })).toBeNull();
  });
});

describe('reportTimeLabel', () => {
  it('writes a stored time on the twelve-hour clock', () => {
    expect(reportTimeLabel('12:05:00')).toBe('12:05 PM');
    expect(reportTimeLabel('7:00')).toBe('7:00 AM');
  });
});

describe('endsLabel', () => {
  const now = new Date('2026-09-30T14:00:00Z');
  it('says today, tomorrow or the date, in the reader zone', () => {
    expect(endsLabel('2026-09-30T22:00:00Z', now, 'UTC')).toBe('Ends today at 10:00 PM');
    expect(endsLabel('2026-10-01T09:00:00Z', now, 'UTC')).toBe('Ends tomorrow at 9:00 AM');
    expect(endsLabel('2026-10-04T09:00:00Z', now, 'UTC')).toBe('Ends Sun 4 Oct');
  });
});

describe('endedUpdate', () => {
  const base: EndedWatch = {
    id: 'w1',
    title: 'Jamie xx at Nowadays',
    status: 'ended',
    at: '2026-10-04T23:23:00Z',
    below: 200,
    fired: null,
    latest: 215,
    first: 240,
    currency: 'USD',
    goalHref: '/goals/g1#step-s1',
  };

  it('says it never fired and where the price finished', () => {
    const update = endedUpdate(base);
    expect(update).toMatchObject({ key: 'watch-w1', module: null, href: '/goals/g1#step-s1' });
    expect(update.text).toBe('Finished watching Jamie xx at Nowadays');
    expect(update.detail).toBe('Never went under $200; last read $215, from $240');
  });

  it('leads with the fire when it went under', () => {
    const update = endedUpdate({ ...base, fired: { value: 180, at: '2026-10-02T10:23:00Z' }, latest: 190 });
    expect(update.detail).toBe('Went under $200 at $180; last read $190, from $240');
  });

  it('says a stopped watch was stopped, and one that never read a price', () => {
    const update = endedUpdate({ ...base, status: 'stopped', below: null, latest: null, first: null });
    expect(update.text).toBe('You stopped watching Jamie xx at Nowadays');
    expect(update.detail).toBe('No price was ever read');
  });
});
