/**
 * What the four check tests share: the fixture pages in ./fixtures/, each
 * built to break one check, and a browser opened once per test file.
 *
 * The tests run wherever Chromium is (this machine's /opt/pw-browsers, the
 * gate) and are skipped where it is not, which is a CI runner: CI's own run
 * of the checks is the gate's, on a machine that has one.
 */
import { afterAll, beforeAll, describe } from 'vitest';
import { chromePath, launch, type Browser } from './browser';
import { checkPage, type Findings } from './checks';

export const FIXTURES = ['clean', 'sideways', 'small-target', 'under-dock', 'faint-text'] as const;

export function fixtureUrl(name: (typeof FIXTURES)[number]): string {
  return new URL(`./fixtures/${name}.html`, import.meta.url).href;
}

export const describeInBrowser = chromePath() ? describe : describe.skip;

/** Opens a browser for the file, and returns a function that checks one fixture. */
export function useFixtures(): (name: (typeof FIXTURES)[number]) => Promise<Findings> {
  let browser: Browser | null = null;
  beforeAll(async () => {
    browser = await launch();
  }, 30_000);
  afterAll(async () => {
    await browser?.close();
  });
  return async (name) => {
    await browser!.page.open(fixtureUrl(name));
    return checkPage(browser!.page);
  };
}
