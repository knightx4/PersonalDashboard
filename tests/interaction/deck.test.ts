/**
 * The two deck checks (docs/UI-QUALITY-SPEC.md, Part 5): Next shows the next
 * item with the network held, and every control and link shows a press
 * within 100 milliseconds. The checks are in ./deck.ts; scripts/check-phone.ts
 * runs them on the gallery surfaces that declare a deck, Quick read among them.
 *
 * The fixtures are served over HTTP rather than opened as files, since the
 * next check holds the network and a file is not fetched over it.
 */
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { launch, type Browser } from './browser';
import { checkDeck, checkNext } from './deck';
import { describeInBrowser } from './fixtures';

const FOLDER = fileURLToPath(new URL('./fixtures/', import.meta.url));
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
const DECK = { next: '#next', item: '[data-deck-item]' };

describeInBrowser('deck checks', () => {
  let browser: Browser | null = null;
  let server: Server | null = null;
  let base = '';

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const name = new URL(request.url ?? '/', 'http://fixtures').pathname.slice(1);
      try {
        if (!/^[\w.-]+$/.test(name)) throw new Error('not a fixture');
        const body = await readFile(FOLDER + name);
        response.writeHead(200, { 'content-type': TYPES[extname(name)] ?? 'application/octet-stream' });
        response.end(body);
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    browser = await launch();
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  it('passes a deck that draws the next story ahead and answers a press', async () => {
    const found = await checkDeck(browser!.page, `${base}deck.html`, DECK);
    expect(found).toEqual({ next: [], press: [] });
  }, 30_000);

  it('fails both on a deck that fetches the next story when Next is pressed', async () => {
    const found = await checkDeck(browser!.page, `${base}deck-no-prefetch.html`, DECK);
    expect(found.next).toHaveLength(1);
    expect(found.next[0]).toMatch(/nothing new/);
    expect(found.press).toEqual([
      'link "Whole issue" shows nothing for 100ms after it is pressed',
      'button "Next story" shows nothing for 100ms after it is pressed',
    ]);
  }, 30_000);

  it('fails next on a deck that draws the words ahead but fetches the picture late', async () => {
    const found = await checkNext(browser!.page, `${base}deck-late-picture.html`, DECK);
    expect(found).toEqual([`the next item's picture ${base}picture.svg?story=2 is fetched only once Next is pressed`]);
  }, 30_000);

  it('names a deck whose Next or item is not on the page', async () => {
    expect(await checkNext(browser!.page, `${base}deck.html`, { ...DECK, next: '#nowhere' })).toEqual([
      'no Next matches #nowhere',
    ]);
  }, 30_000);
});
