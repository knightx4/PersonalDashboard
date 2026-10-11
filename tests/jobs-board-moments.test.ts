/**
 * The three Jobs moments on the Pipeline board (plan #1596), and what each
 * leaves under reduced motion: the travel, the ring and the fade go, and the
 * names that say where the role went stay. The frame strips in the gallery
 * show the full versions; a recording cannot ask for reduced motion, so the
 * reduced ones are held here, with the arithmetic that carries the board from
 * one state to the next.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const reduced = vi.hoisted(() => ({ on: false }));
const settle = vi.hoisted(() => vi.fn());

vi.mock('@/components/motion/reduced', () => ({ prefersReducedMotion: () => reduced.on }));
vi.mock('@/components/motion/settle', () => ({ settle }));

import {
  FADE_KEYFRAMES,
  fadeInPlace,
  glideBoard,
  glideOffsets,
  playForward,
  playOffer,
  type BoardLayout,
} from '@/components/jobs/pipeline/moments';

function fakeCard() {
  const animate = vi.fn(() => ({ finished: Promise.resolve() }));
  const card = {
    animate,
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 280, height: 72 }),
  } as unknown as HTMLElement;
  return { card, animate };
}

const before: BoardLayout = new Map();

/** A board root with nothing on it, which records whether anything animated. */
function fakeRoot() {
  const animate = vi.fn(() => ({ finished: Promise.resolve() }));
  const root = { animate, querySelectorAll: () => [] } as unknown as HTMLElement;
  return { root, animate };
}

const EDGE = { at: 'edge', pulse: false };

beforeEach(() => {
  settle.mockClear();
});

describe('glideOffsets', () => {
  it('changes a lane between its two heights, leaving the lanes above to carry it', () => {
    const was: BoardLayout = new Map([['lane:offer', { left: 0, top: 500, width: 350, height: 80 }]]);
    const now: BoardLayout = new Map([['lane:offer', { left: 0, top: 420, width: 350, height: 160 }]]);
    expect(glideOffsets(was, now, () => null).get('lane:offer')).toEqual({
      dx: 0,
      dy: 0,
      fromHeight: 80,
      toHeight: 160,
    });
  });

  it('moves a card by its own offset less the lane that carries it', () => {
    const was: BoardLayout = new Map([
      ['lane:offer', { left: 0, top: 500, width: 350, height: 80 }],
      ['card:p1', { left: 8, top: 340, width: 330, height: 72 }],
    ]);
    const now: BoardLayout = new Map([
      ['lane:offer', { left: 0, top: 420, width: 350, height: 160 }],
      ['card:p1', { left: 8, top: 460, width: 330, height: 72 }],
    ]);
    // The card went 120px down the screen while its lane went 80px up, so
    // the card starts 200px above where the lane's own glide would put it.
    expect(glideOffsets(was, now, () => 'lane:offer').get('card:p1')).toEqual({ dx: 0, dy: -200 });
  });

  it('leaves out what was not on the board before', () => {
    const now: BoardLayout = new Map([['card:p1', { left: 8, top: 460, width: 330, height: 72 }]]);
    expect(glideOffsets(new Map(), now, () => null).size).toBe(0);
  });
});

describe('with motion', () => {
  beforeEach(() => {
    reduced.on = false;
  });

  it('a role moving forward glides, then is named with its new column on its own edge', async () => {
    const { card } = fakeCard();
    const { root } = fakeRoot();
    await playForward(root, card, before, 'In process');
    expect(settle).toHaveBeenCalledWith(card, 'In process', EDGE);
  });

  it('an offer glides and is named "Offer · " and the company', async () => {
    const { card } = fakeCard();
    await playOffer(null, card, before, ' Marshall Wace ');
    expect(settle).toHaveBeenCalledWith(card, 'Offer · Marshall Wace', EDGE);
  });

  it('a rejection fades the card where it stands', async () => {
    const { card, animate } = fakeCard();
    await fadeInPlace(card);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0]?.[0 as never]).toEqual(FADE_KEYFRAMES);
  });
});

describe('under reduced motion', () => {
  beforeEach(() => {
    reduced.on = true;
  });

  it('a role moving forward is still named with its new column, with no glide', async () => {
    const { card, animate } = fakeCard();
    const { root, animate: rootAnimate } = fakeRoot();
    await playForward(root, card, before, 'In process');
    expect(settle).toHaveBeenCalledWith(card, 'In process', EDGE);
    expect(animate).not.toHaveBeenCalled();
    expect(rootAnimate).not.toHaveBeenCalled();
  });

  it('an offer is still named "Offer · " and the company, with no ring', async () => {
    const { card, animate } = fakeCard();
    await playOffer(null, card, before, 'Marshall Wace');
    expect(settle).toHaveBeenCalledWith(card, 'Offer · Marshall Wace', EDGE);
    expect(animate).not.toHaveBeenCalled();
  });

  it('the lane a rejected card left is simply closed, with no glide', async () => {
    const { root, animate } = fakeRoot();
    await glideBoard(root, before);
    expect(animate).not.toHaveBeenCalled();
  });

  it('a rejection goes at once, with no fade', async () => {
    const { card, animate } = fakeCard();
    await fadeInPlace(card);
    expect(animate).not.toHaveBeenCalled();
  });
});
