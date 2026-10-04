/**
 * Text over a panel meets the contrast floor check:contrast uses, at 390 pixels
 * (docs/UI-QUALITY-SPEC.md, Part 5). The check itself is in ./checks.ts and
 * ./probe.ts; scripts/check-phone.ts runs it on the surfaces a change touched.
 */
import { expect, it } from 'vitest';
import { describeInBrowser, useFixtures } from './fixtures';

describeInBrowser('contrast check', () => {
  const check = useFixtures();

  it('fails on a page built to break it, and on nothing else there', async () => {
    const found = await check('faint-text');
    expect(found.contrast.length).toBeGreaterThan(0);
    for (const [name, lines] of Object.entries(found)) if (name !== 'contrast') expect(lines).toEqual([]);
  });

  it('passes on a page built to pass', async () => {
    const found = await check('clean');
    expect(found.contrast).toEqual([]);
  });
});
