/**
 * Nothing scrolls sideways at 390 pixels: rule R2
 * (docs/UI-QUALITY-SPEC.md, Part 5). The check itself is in ./checks.ts and
 * ./probe.ts; scripts/check-phone.ts runs it on the surfaces a change touched.
 */
import { expect, it } from 'vitest';
import { describeInBrowser, useFixtures } from './fixtures';

describeInBrowser('sideways check', () => {
  const check = useFixtures();

  it('fails on a page built to break it, and on nothing else there', async () => {
    const found = await check('sideways');
    expect(found.sideways.length).toBeGreaterThan(0);
    for (const [name, lines] of Object.entries(found)) if (name !== 'sideways') expect(lines).toEqual([]);
  });

  it('passes on a page built to pass', async () => {
    const found = await check('clean');
    expect(found.sideways).toEqual([]);
  });
});
