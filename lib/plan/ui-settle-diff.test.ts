import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beforeShotFile, shotFile, SHOT_NAMES } from '../preview/ui-checks';
import {
  compareSurfaceShots,
  differingPixels,
  fileShotReader,
  localCheckRounds,
  settleRefusal,
  surfacesToCompare,
  type RawShot,
} from './ui-settle-diff';

const WIDTH = 120;
const HEIGHT = 80;

/** A plain shot with an optional dark box drawn on it. */
function shot(box?: { x: number; y: number; w: number; h: number }, height = HEIGHT): RawShot {
  const data = new Uint8Array(WIDTH * height * 4).fill(255);
  if (box) {
    for (let y = box.y; y < box.y + box.h; y++) {
      for (let x = box.x; x < box.x + box.w; x++) {
        const i = (y * WIDTH + x) * 4;
        data[i] = 20;
        data[i + 1] = 20;
        data[i + 2] = 20;
      }
    }
  }
  return { width: WIDTH, height, data };
}

async function writePng(root: string, path: string, raw: RawShot): Promise<void> {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  await sharp(Buffer.from(raw.data), { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .png()
    .toFile(full);
}

describe('differingPixels', () => {
  it('counts no pixels on the same picture and ignores a few levels of anti-aliasing', () => {
    const a = shot({ x: 10, y: 10, w: 20, h: 5 });
    const b = shot({ x: 10, y: 10, w: 20, h: 5 });
    b.data[0] = 240;
    expect(differingPixels(a, b)).toBe(0);
  });

  it('counts the pixels a moved box covers and uncovers', () => {
    expect(
      differingPixels(shot({ x: 10, y: 10, w: 10, h: 10 }), shot({ x: 15, y: 10, w: 10, h: 10 })),
    ).toBe(100);
  });

  it('reads a change of height as a change, whatever the pixels', () => {
    expect(differingPixels(shot(), shot(undefined, HEIGHT + 8))).toBeNull();
  });
});

describe('compareSurfaceShots', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ui-settle-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function shootBoth(surface: string, before: RawShot, after: RawShot): Promise<void> {
    for (const name of SHOT_NAMES) {
      await writePng(root, beforeShotFile(surface, name), before);
      await writePng(root, shotFile(surface, name), after);
    }
  }

  it('lets an unchanged surface through and refuses a changed one, naming it', async () => {
    const box = { x: 10, y: 10, w: 30, h: 8 };
    await shootBoth('runner-panel', shot(box), shot(box));
    // The essay editor's gap: the same box, eight pixels lower.
    await shootBoth('learn-essay', shot(box), shot({ ...box, y: 18 }));

    const read = fileShotReader(root);
    const same = await compareSurfaceShots('runner-panel', read);
    const changed = await compareSurfaceShots('learn-essay', read);
    expect(same).toEqual({ surface: 'runner-panel', outcome: 'same', reasons: [] });
    expect(changed.outcome).toBe('changed');
    expect(changed.reasons).toHaveLength(SHOT_NAMES.length);
    expect(changed.reasons[0]).toMatch(/^phone-light differs in \d+ pixels/);

    expect(settleRefusal('#2215.4', 2219, [same])).toBeNull();
    const refusal = settleRefusal('#2215.4', 2219, [same, changed]);
    expect(refusal).toContain(
      'Settle refused on #2215.4: one surface is not shown to look the same as on main',
    );
    expect(refusal).toContain('learn-essay: phone-light differs');
    expect(refusal).not.toContain('runner-panel');
    expect(refusal).toContain('npm run ui-check -- 2219 learn-essay <round>');
  });

  it("refuses a surface with no shot of main's, since nothing shows it unchanged", async () => {
    for (const name of SHOT_NAMES) await writePng(root, shotFile('news-home', name), shot());
    const result = await compareSurfaceShots('news-home', fileShotReader(root));
    expect(result.outcome).toBe('unshot');
    expect(result.reasons[0]).toBe("phone-light has no shot of main's");
    expect(settleRefusal('#9', 9, [result])).toContain('.preview-shots/before/');
  });
});

describe('surfacesToCompare', () => {
  it('compares every waiting surface except one the critic stopped on at round 3', () => {
    const checks = [
      { surface: 'stopped', round: 3, verdict: 'fix' },
      { surface: 'early', round: 1, verdict: 'fix' },
      { surface: 'passed', round: 2, verdict: 'pass' },
    ];
    expect(surfacesToCompare(['stopped', 'early', 'passed', 'shared'], checks)).toEqual([
      'early',
      'shared',
    ]);
  });
});

describe('localCheckRounds', () => {
  it("reads this step's verdict files and skips other steps and broken files", () => {
    const root = mkdtempSync(join(tmpdir(), 'ui-settle-'));
    try {
      const dir = join(root, '.preview-shots/checks');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, '42--news-home--r3.json'), JSON.stringify({ verdict: 'fix' }));
      writeFileSync(join(dir, '42--news-home--r3--phone-light.png'), '');
      writeFileSync(join(dir, '420--news-home--r1.json'), JSON.stringify({ verdict: 'pass' }));
      writeFileSync(join(dir, '42--jobs-role--r1.json'), 'not json');
      expect(localCheckRounds(42, root)).toEqual([
        { surface: 'news-home', round: 3, verdict: 'fix' },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
