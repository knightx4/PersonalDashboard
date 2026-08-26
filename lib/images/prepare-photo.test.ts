import { describe, expect, it } from 'vitest';
import { fitWithin, MAX_EDGE } from '@/lib/images/prepare-photo';
import { parseImageDataUrl } from '@/lib/images/data-url';

describe('fitWithin', () => {
  it('leaves images already inside the box alone', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('scales a 12MP portrait iPhone photo by its long edge', () => {
    // 3024x4032 is the iPhone main-camera portrait size.
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: MAX_EDGE });
  });

  it('scales landscape by width and keeps the aspect ratio', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: MAX_EDGE, height: 1200 });
  });

  it('never returns a zero dimension', () => {
    expect(fitWithin(4000, 3, 1600)).toEqual({ width: 1600, height: 1 });
  });
});

describe('parseImageDataUrl', () => {
  it('accepts the four types the model API takes', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      const parsed = parseImageDataUrl(`data:${type};base64,QUJD`);
      expect(parsed.ok).toBe(true);
    }
  });

  it('explains a HEIC that slipped past the browser conversion', () => {
    const parsed = parseImageDataUrl('data:image/heic;base64,QUJD');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/iPhone photo did not get converted/);
  });

  it('rejects a non-image payload', () => {
    expect(parseImageDataUrl('not a data url').ok).toBe(false);
  });

  it('rejects an oversized payload', () => {
    const parsed = parseImageDataUrl(`data:image/jpeg;base64,${'A'.repeat(6_000_000)}`);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/too large/);
  });
});
