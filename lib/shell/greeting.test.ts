import { describe, expect, it } from 'vitest';
import { greetingFor, timeOfDayGreeting } from './greeting';

describe('timeOfDayGreeting', () => {
  it('reads the hour where the reader is', () => {
    const now = new Date('2026-11-04T15:00:00Z');
    expect(timeOfDayGreeting('UTC', now)).toBe('Good afternoon');
    expect(timeOfDayGreeting('America/Los_Angeles', now)).toBe('Good morning');
    expect(timeOfDayGreeting('Asia/Tokyo', now)).toBe('Still up');
    expect(timeOfDayGreeting('Europe/Moscow', now)).toBe('Good evening');
  });
});

describe('greetingFor', () => {
  const now = new Date('2026-11-04T15:00:00Z');
  it('adds the first word of the name', () => {
    expect(greetingFor('UTC', now, 'Selvey Smith')).toBe('Good afternoon, Selvey');
  });
  it('leaves the name out when there is none', () => {
    expect(greetingFor('UTC', now, null)).toBe('Good afternoon');
    expect(greetingFor('UTC', now, '  ')).toBe('Good afternoon');
  });
});
