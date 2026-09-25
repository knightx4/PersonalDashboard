import { describe, expect, it } from 'vitest';
import type { TrackActivity, TrackWeight } from '@/lib/learn/flow/interest';
import { pickedUpSince, restingTrackToOffer, weeksResting, type RestingPress } from './resting';

/**
 * A resting track offered back in Learn now (plan #1045), against rows
 * written by hand: offered two weeks after it goes dormant, never a goal's
 * track, and each of the three presses doing what the card says.
 */

const NOW = new Date('2026-09-25T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

const activity = (lastUsed?: string): TrackActivity => ({
  answered: 0,
  skipped: 0,
  pushedAside: 0,
  answeredBefore: lastUsed ? 3 : 0,
  lastUsed,
});
const stopped: TrackWeight = { weight: 0.5, stopped: true };
const live: TrackWeight = { weight: 1, stopped: false };

function offer(input: {
  lastUsed?: Record<string, string>;
  weights?: Record<string, TrackWeight>;
  goalTracks?: string[];
  record?: RestingPress[];
  names?: string[];
}) {
  const names = input.names ?? Object.keys(input.lastUsed ?? {});
  return restingTrackToOffer({
    tracks: names.map((name) => ({ subjectId: name, name })),
    activity: new Map(names.map((name) => [name, activity(input.lastUsed?.[name])])),
    weights: new Map(names.map((name) => [name, input.weights?.[name] ?? stopped])),
    goalTracks: new Set(input.goalTracks ?? []),
    record: input.record ?? [],
    now: NOW,
  });
}

describe('restingTrackToOffer', () => {
  it('offers a track dormant for two weeks, and not one dormant for less', () => {
    expect(offer({ lastUsed: { a: daysAgo(43) } })?.subjectId).toBe('a');
    expect(offer({ lastUsed: { a: daysAgo(40) } })).toBeNull();
  });

  it('offers only a track whose weight has stopped', () => {
    expect(offer({ lastUsed: { a: daysAgo(50) }, weights: { a: live } })).toBeNull();
  });

  it('never offers a goal track', () => {
    expect(offer({ lastUsed: { a: daysAgo(50) }, goalTracks: ['a'] })).toBeNull();
  });

  it('offers the track dormant longest, one at a time', () => {
    const chosen = offer({ lastUsed: { newer: daysAgo(45), older: daysAgo(70) } });
    expect(chosen).toEqual({ subjectId: 'older', name: 'older', lastUsed: daysAgo(70) });
  });

  it('holds a track back for four weeks after Not now', () => {
    const lastUsed = { a: daysAgo(60) };
    expect(offer({ lastUsed, record: [{ subjectId: 'a', outcome: 'not_now', happenedAt: daysAgo(10) }] })).toBeNull();
    expect(offer({ lastUsed, record: [{ subjectId: 'a', outcome: 'not_now', happenedAt: daysAgo(29) }] })?.subjectId).toBe('a');
  });

  it('stops offering after Let it rest until the track is used again', () => {
    const rested: RestingPress = { subjectId: 'a', outcome: 'rested', happenedAt: daysAgo(55) };
    expect(offer({ lastUsed: { a: daysAgo(60) }, record: [rested] })).toBeNull();
    // Used after the press, then dormant again for two weeks: offered again.
    expect(offer({ lastUsed: { a: daysAgo(45) }, record: [rested] })?.subjectId).toBe('a');
  });

  it('after Pick it up, waits for the track to go dormant again and two weeks more', () => {
    const lastUsed = { a: daysAgo(80) };
    const picked = (days: number): RestingPress[] => [{ subjectId: 'a', outcome: 'picked_up', happenedAt: daysAgo(days) }];
    expect(offer({ lastUsed, record: picked(20) })).toBeNull();
    expect(offer({ lastUsed, record: picked(35) })).toBeNull();
    expect(offer({ lastUsed, record: picked(43) })?.subjectId).toBe('a');
  });

  it('leaves out a track never used', () => {
    expect(offer({ names: ['a'] })).toBeNull();
  });
});

describe('pickedUpSince', () => {
  it('names the tracks picked up in the last four weeks', () => {
    const record: RestingPress[] = [
      { subjectId: 'recent', outcome: 'picked_up', happenedAt: daysAgo(3) },
      { subjectId: 'old', outcome: 'picked_up', happenedAt: daysAgo(30) },
      { subjectId: 'held', outcome: 'not_now', happenedAt: daysAgo(3) },
    ];
    expect([...pickedUpSince(record, NOW)]).toEqual(['recent']);
  });
});

describe('weeksResting', () => {
  it('counts whole weeks', () => {
    expect(weeksResting(daysAgo(43), NOW)).toBe(6);
  });
});
