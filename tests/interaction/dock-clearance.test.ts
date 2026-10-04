/**
 * Nothing a person can press sits under the dock at 390 pixels
 * (docs/UI-QUALITY-SPEC.md, Part 5). The check itself is in ./checks.ts and
 * ./probe.ts; scripts/check-phone.ts runs it on the surfaces a change touched.
 */
import { expect, it } from 'vitest';
import { describeInBrowser, useFixtures } from './fixtures';

describeInBrowser('dock check', () => {
  const check = useFixtures();

  it('fails on a page built to break it, and on nothing else there', async () => {
    const found = await check('under-dock');
    expect(found.dock.length).toBeGreaterThan(0);
    for (const [name, lines] of Object.entries(found)) if (name !== 'dock') expect(lines).toEqual([]);
  });

  it('passes on a page built to pass', async () => {
    const found = await check('clean');
    expect(found.dock).toEqual([]);
  });
});
