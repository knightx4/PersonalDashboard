import { describe, expect, it } from 'vitest';
import {
  between,
  SKY,
  crowding,
  dustAt,
  DUST_SPREAD,
  fitCamera,
  lightOn,
  markGrid,
  MAX_ZOOM,
  overlaps,
  panBy,
  placeNames,
  rgbOf,
  starColour,
  starLook,
  toScreen,
  toWorld,
  zoomAbout,
  type NameCandidate,
} from './sky';
import { DOMAIN_HUES } from './view';

const W = 400;
const H = 300;

describe('the camera', () => {
  it('fits every point inside the frame, centred', () => {
    const points = [
      { x: -1, y: -0.5 },
      { x: 1, y: 0.5 },
    ];
    const camera = fitCamera(points, W, H, 20);
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
    for (const p of points) {
      const s = toScreen(camera, p, W, H);
      expect(s.x).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(s.x).toBeLessThanOrEqual(W - 20 + 1e-9);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(H);
    }
  });

  it('draws up in the layout as up on the screen', () => {
    const camera = { x: 0, y: 0, k: 100 };
    expect(toScreen(camera, { x: 0, y: 1 }, W, H).y).toBeLessThan(H / 2);
  });

  it('turns a screen point back into the same layout point', () => {
    const camera = { x: 0.3, y: -0.2, k: 250 };
    const p = { x: 0.1, y: 0.4 };
    const back = toWorld(camera, toScreen(camera, p, W, H), W, H);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it('keeps the point under the finger still while zooming', () => {
    const camera = { x: 0, y: 0, k: 100 };
    const finger = { x: 300, y: 80 };
    const under = toWorld(camera, finger, W, H);
    const zoomed = zoomAbout(camera, finger, 3, W, H, 100);
    expect(zoomed.k).toBe(300);
    const after = toScreen(zoomed, under, W, H);
    expect(after.x).toBeCloseTo(finger.x, 6);
    expect(after.y).toBeCloseTo(finger.y, 6);
  });

  it('stops zooming in at the limit', () => {
    const zoomed = zoomAbout({ x: 0, y: 0, k: 100 }, { x: 200, y: 150 }, 1000, W, H, 100);
    expect(zoomed.k).toBe(100 * MAX_ZOOM);
  });

  it('moves the ground with a drag', () => {
    const camera = { x: 0, y: 0, k: 100 };
    const p = { x: 0.2, y: 0.2 };
    const before = toScreen(camera, p, W, H);
    const after = toScreen(panBy(camera, 30, -10), p, W, H);
    expect(after.x - before.x).toBeCloseTo(30, 9);
    expect(after.y - before.y).toBeCloseTo(-10, 9);
  });

  it('flies evenly in the logarithm of the scale', () => {
    const mid = between({ x: 0, y: 0, k: 10 }, { x: 2, y: 2, k: 1000 }, 0.5);
    expect(mid.k).toBeCloseTo(100, 6);
    expect(mid.x).toBe(1);
  });
});

describe('how a star looks', () => {
  it('grows brighter and wider with strength', () => {
    const dim = starLook(0.2, 0, 1);
    const bright = starLook(0.9, 0, 1);
    expect(bright.glowAlpha).toBeGreaterThan(dim.glowAlpha);
    expect(bright.glow).toBeGreaterThan(dim.glow);
    expect(bright.core).toBeGreaterThan(dim.core);
  });

  it('draws an unknown idea as a dim point, with haze only where known ideas spill onto it', () => {
    const bare = starLook(0, 0, 1);
    expect(bare.glow).toBe(0);
    expect(bare.haze).toBe(0);
    const hazed = starLook(0, 0.6, 1);
    expect(hazed.haze).toBeGreaterThan(0);
    expect(hazed.hazeAlpha).toBeGreaterThan(0);
  });

  it('gives a star its domain colour, and a plain one without a domain', () => {
    expect(starColour(2)).toBe(DOMAIN_HUES[2]!.dark);
    expect(starColour('none')).toBe(starColour('other'));
    expect(rgbOf('#ff8000')).toEqual([255, 128, 0]);
  });
});

describe('names', () => {
  const name = (id: string, x: number, y: number, priority: number, gap = 6): NameCandidate => ({
    id,
    text: id,
    at: { x, y },
    priority,
    width: 60,
    gap,
  });

  it('never lets two names overlap', () => {
    const many = Array.from({ length: 30 }, (_, i) => name(`n${i}`, 100 + (i % 5) * 8, 100 + i * 3, i));
    const placed = placeNames(many, W, H, 16);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlaps(placed[i]!.box, placed[j]!.box)).toBe(false);
      }
    }
    expect(placed.length).toBeGreaterThan(1);
    expect(placed.length).toBeLessThan(many.length);
  });

  it('places the most important name first', () => {
    const placed = placeNames([name('low', 100, 100, 1, 0), name('high', 100, 100, 9, 0)], W, H, 16);
    expect(placed[0]!.id).toBe('high');
  });

  it('leaves out a name that cannot fit inside the frame', () => {
    const wide = { ...name('wide', W / 2, H / 2, 1, 0), width: W + 10 };
    expect(placeNames([wide], W, H, 16)).toEqual([]);
  });

  it('keeps a name off the stars', () => {
    const marks = markGrid();
    marks.add(100, 100, 4);
    const placed = placeNames([name('place', 100, 100, 1, 0)], W, H, 16, [], 7, (box) => marks.covers(box));
    expect(placed).toHaveLength(1);
    expect(marks.covers(placed[0]!.box)).toBe(false);
  });

  it('keeps clear of boxes already taken', () => {
    const taken = [{ x: 0, y: 0, w: W, h: H }];
    expect(placeNames([name('any', 100, 100, 1)], W, H, 16, taken)).toEqual([]);
  });
});

describe('lighting the ideas', () => {
  const on = new Date('2026-10-13T12:00:00Z');
  const known = {
    id: 'k',
    stateRow: {
      state: 'known' as const,
      established: 'tested' as const,
      tested_at: '2026-10-13T12:00:00Z',
      declared_at: null,
      review_interval_days: null,
    },
    neighbours: [{ id: 'u', similarity: 0.8 }],
  };
  const unknown = { id: 'u', stateRow: null, neighbours: [{ id: 'k', similarity: 0.8 }] };

  it('gives a known idea its strength and no haze, and an unknown one haze from it', () => {
    const light = lightOn([known, unknown], on);
    expect(light.get('k')).toEqual({ strength: 0.8, haze: 0 });
    expect(light.get('u')!.strength).toBe(0);
    expect(light.get('u')!.haze).toBeCloseTo(0.8 * 0.64, 9);
  });

  it('dims as the days pass', () => {
    const later = lightOn([known, unknown], new Date('2026-11-12T12:00:00Z'));
    expect(later.get('k')!.strength).toBeCloseTo(0.4, 9);
  });
});

describe('dust', () => {
  it('sits beside its idea, further off the less alike they are, the same on every visit', () => {
    const idea = { x: 0.5, y: 0.5 };
    const near = dustAt(idea, 'note-a', 0.9);
    const far = dustAt(idea, 'note-a', 0.2);
    const d = (p: { x: number; y: number }) => Math.hypot(p.x - idea.x, p.y - idea.y);
    expect(d(near)).toBeLessThan(d(far));
    expect(d(far)).toBeLessThanOrEqual(DUST_SPREAD * 1.4 + 1e-9);
    expect(dustAt(idea, 'note-a', 0.2)).toEqual(far);
  });
});

describe('a crowded sky', () => {
  it('keeps every glow up to four hundred stars in view, then thins it', () => {
    expect(crowding(10)).toBe(1);
    expect(crowding(400)).toBe(1);
    expect(crowding(10_000)).toBeCloseTo(0.2, 9);
  });
});

describe('the panels on the sky', () => {
  const lum = (hex: string) => {
    const [r, g, b] = rgbOf(hex).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  it('is dark and fixed, so the card and zoom buttons read the same in a light theme', () => {
    expect(SKY.panel).toMatch(/^rgba\(\d+, \d+, \d+, 0\.9/);
    const ground = lum(SKY.groundInner);
    expect(ground).toBeLessThan(0.02);
    expect((lum(SKY.panelText) + 0.05) / (ground + 0.05)).toBeGreaterThan(7);
  });
});
