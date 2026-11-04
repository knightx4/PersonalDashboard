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

  it('passes a fixed pane above the dock whose scroller holds a button past its foot', async () => {
    // The button's box reaches into the dock's band, but the scroller clips it
    // at 690px, so nothing of it is drawn, or pressable, under the dock.
    const found = await check('scrolling-pane');
    expect(found.dock).toEqual([]);
  });
});
