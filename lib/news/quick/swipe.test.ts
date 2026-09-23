import { describe, expect, it } from 'vitest';
import { swipeAxis, swipeFarEnough } from '@/lib/news/quick/swipe';

describe('swipeAxis', () => {
  it('waits until the drag has moved past the slop', () => {
    expect(swipeAxis(0, 0)).toBeNull();
    expect(swipeAxis(-9, 4)).toBeNull();
  });

  it('claims a drag that is mostly to the left', () => {
    expect(swipeAxis(-12, 3)).toBe('swipe');
    expect(swipeAxis(-40, -30)).toBe('swipe');
  });

  it('leaves scrolling up and down to the page', () => {
    expect(swipeAxis(0, -40)).toBe('page');
    expect(swipeAxis(-5, 60)).toBe('page');
    expect(swipeAxis(-30, -30)).toBe('page');
  });

  it('leaves a drag to the right to the page', () => {
    expect(swipeAxis(40, 0)).toBe('page');
  });
});

describe('swipeFarEnough', () => {
  it('needs a third of the card', () => {
    expect(swipeFarEnough(-119, 360)).toBe(false);
    expect(swipeFarEnough(-120, 360)).toBe(true);
  });

  it('never counts a drag to the right or a card with no width', () => {
    expect(swipeFarEnough(200, 360)).toBe(false);
    expect(swipeFarEnough(-50, 0)).toBe(false);
  });
});
