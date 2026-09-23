import { describe, expect, it } from 'vitest';
import { createPassTracker, leftThroughTop, type Sighting } from './scroll';

/** A card on the screen, above it, and below it, with the viewport as the root. */
const inView: Sighting = { isIntersecting: true, bottom: 400, rootTop: 0 };
const above: Sighting = { isIntersecting: false, bottom: -20, rootTop: 0 };
const below: Sighting = { isIntersecting: false, bottom: 1600, rootTop: 0 };

function tracker() {
  const passed: string[] = [];
  return { passed, track: createPassTracker((id) => passed.push(id)) };
}

describe('passing a card by scrolling', () => {
  it('reads a card as gone through the top only when its bottom is above the root', () => {
    expect(leftThroughTop(above)).toBe(true);
    expect(leftThroughTop(below)).toBe(false);
    expect(leftThroughTop(inView)).toBe(false);
    expect(leftThroughTop({ isIntersecting: false, bottom: 60, rootTop: 60 })).toBe(true);
  });

  it('marks a card that was on the screen and then scrolled out above', () => {
    const { passed, track } = tracker();
    track.sighted('a', inView);
    expect(track.sighted('a', above)).toBe(true);
    expect(passed).toEqual(['a']);
  });

  it('leaves a card that never came into view', () => {
    const { passed, track } = tracker();
    track.sighted('a', below);
    track.sighted('a', above);
    expect(passed).toEqual([]);
  });

  it('leaves a card you scrolled back up away from', () => {
    const { passed, track } = tracker();
    track.sighted('a', inView);
    track.sighted('a', below);
    expect(passed).toEqual([]);
  });

  it('marks a card once however often it goes out above', () => {
    const { passed, track } = tracker();
    track.sighted('a', inView);
    track.sighted('a', above);
    track.sighted('a', inView);
    expect(track.sighted('a', above)).toBe(false);
    expect(passed).toEqual(['a']);
  });

  it('makes one write between Next and the scroll it causes', () => {
    const { passed, track } = tracker();
    track.sighted('a', inView);
    expect(track.next('a')).toBe(true);
    expect(track.sighted('a', above)).toBe(false);
    expect(track.next('a')).toBe(false);
    expect(passed).toEqual(['a']);
  });

  it('never marks a card saved or turned down this visit', () => {
    const { passed, track } = tracker();
    track.sighted('a', inView);
    track.settle('a');
    track.sighted('a', above);
    expect(passed).toEqual([]);
  });
});
