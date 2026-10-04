/**
 * The two deck checks of docs/UI-QUALITY-SPEC.md, Part 5, at 390 pixels:
 *
 *   next    Next shows the next item with the network held, so the item was
 *           drawn, and its picture fetched, before Next was pressed
 *   press   every control and link shows it was pressed within 100ms
 *
 * They run on the gallery surfaces that declare a `deck`
 * (lib/preview/deck.ts), after the four checks in ./checks.ts. Each opens
 * the page again, since a press changes it.
 *
 * Next is held to the network rather than to a clock: every request made
 * from the moment Next is pressed is paused and never answered, so whatever
 * the item shows by then was already in the page. A deck that fetches the
 * next item when Next is pressed shows nothing new however fast the server
 * is, and one that draws it ahead but fetches its picture late shows the
 * words with the picture's request waiting.
 *
 * The press check opens the page with motion on (the app's pressed state is
 * a transition, `press` in globals.css, and it drops out under reduced
 * motion), rests the pointer on each control so its hover state is part of
 * the picture before, holds the network, then presses for 50ms and lets go.
 * It compares the computed look of the control, its children and the four
 * elements round it on every frame for 100ms from the moment the button
 * went down; any change counts, from a scale on :active to a "Loading…"
 * label or the page changing (a link Next has prefetched changes it at
 * once). A link out of the app, to another site or a new tab, counts when
 * the browser goes to open it, which is its own answer to the press; the
 * check stops it there. Controls drawn the same way (the same classes all
 * the way down) are pressed once, and one covered by something else, such as
 * the dock, is left to the dock check.
 *
 * The in-page half is a string, as ./probe.ts is, so nothing rewrites it.
 */
import type { Deck } from '../../lib/preview/deck';
import { PHONE, type Page } from './browser';

/** How soon a press has to show, in milliseconds. */
export const PRESS_MS = 100;
/** How long Next has to show the next item with the network held. */
export const NEXT_WAIT_MS = 1000;
/** How long the pointer rests on a control before it is pressed, so its hover state settles. */
const HOVER_MS = 250;
/** How long the button stays down. */
const HOLD_MS = 50;
/** The most distinct controls pressed on one surface. */
const MAX_PRESSES = 40;

export type DeckFindings = { next: string[]; press: string[] };

/** Installs window.__deck on the open page: the in-page half of both checks. */
const HELPERS = String.raw`(function () {
  if (window.__deck) return true;
  var PRESSABLE = 'a[href], button, [role="button"], summary';
  var PROPS = ['transform', 'scale', 'translate', 'rotate', 'opacity', 'filter', 'color',
    'background-color', 'background-image', 'box-shadow', 'outline-color', 'outline-style',
    'outline-width', 'border-top-color', 'text-decoration-line', 'visibility'];
  function frame() {
    return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
  }
  function shown(el) {
    if (el.closest('[inert], [aria-hidden="true"], [hidden]')) return false;
    if (el.disabled) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }
  function list() {
    return Array.prototype.filter.call(document.querySelectorAll(PRESSABLE), shown);
  }
  function name(el) {
    var label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '')
      .replace(/\s+/g, ' ').trim();
    if (label.length > 40) label = label.slice(0, 39) + '…';
    return (el.tagName === 'A' ? 'link' : 'button') + (label ? ' "' + label + '"' : '');
  }
  function signature(el) {
    var kids = Array.prototype.map.call(el.querySelectorAll('*'), function (k) {
      return k.tagName + '.' + (k.getAttribute('class') || '');
    }).join(' ');
    return [el.tagName, el.getAttribute('class') || '', el.getAttribute('target') || '', kids].join('|');
  }
  function look(el, pseudo) {
    var cs = getComputedStyle(el, pseudo);
    return PROPS.map(function (p) { return cs.getPropertyValue(p); }).join(';');
  }
  function snap(el) {
    if (!el.isConnected) return 'gone';
    var parts = [el.textContent, el.getAttribute('aria-busy') || '',
      look(el, '::before'), look(el, '::after')];
    var up = el;
    for (var i = 0; i < 5 && up; i++) { parts.push(look(up)); up = up.parentElement; }
    var kids = el.querySelectorAll('*');
    for (var j = 0; j < kids.length && j < 40; j++) parts.push(look(kids[j]));
    return parts.join('\n');
  }
  function external(el) {
    if (el.tagName !== 'A') return false;
    return el.target === '_blank' || el.origin !== location.origin;
  }
  function centre(el) {
    var r = el.getBoundingClientRect();
    var top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight);
    var left = Math.max(r.left, 0), right = Math.min(r.right, innerWidth);
    var x = Math.round(left + (right - left) / 2), y = Math.round(top + (bottom - top) / 2);
    var hit = document.elementFromPoint(x, y);
    return { x: x, y: y, covered: !hit || !(hit === el || el.contains(hit)) };
  }
  function itemText(selector) {
    var item = document.querySelector(selector);
    if (!item) return null;
    var copy = item.cloneNode(true);
    copy.querySelectorAll('button, [role="button"], [aria-busy], [aria-live], [hidden]').forEach(function (n) { n.remove(); });
    return (copy.textContent || '').replace(/\s+/g, ' ').trim();
  }
  var state = null;
  window.__deck = {
    targets: function () {
      return list().map(function (el, index) { return { index: index, what: name(el), signature: signature(el) }; });
    },
    place: function (index) {
      var el = list()[index];
      if (!el) return Promise.resolve(null);
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      return frame().then(function () { return centre(el); });
    },
    placeNext: function (selector) {
      var el = document.querySelector(selector);
      if (!el) return Promise.resolve(null);
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      return frame().then(function () { return centre(el); });
    },
    arm: function (index, ms) {
      var el = list()[index];
      if (!el) return Promise.resolve({ armed: false, restless: false });
      var rest = snap(el);
      return new Promise(function (r) { setTimeout(r, 100); }).then(frame).then(function () {
        if (snap(el) !== rest) return { armed: false, restless: true };
        var down = null, first = null, started = performance.now();
        // A link out of the app is answered by the browser opening its page,
        // which it does on the click unless the page stopped it. That counts
        // as the press showing; the page itself is not opened.
        var guard = function (event) {
          if (!external(el) || !el.contains(event.target)) return;
          if (!event.defaultPrevented && down !== null && first === null) first = Math.round(performance.now() - down);
          event.preventDefault();
        };
        var onDown = function () { if (down === null) down = performance.now(); };
        // Bubbling on the window, so it runs after the page's own handlers.
        window.addEventListener('click', guard);
        window.addEventListener('pointerdown', onDown, true);
        window.addEventListener('mousedown', onDown, true);
        state = new Promise(function (resolve) {
          function finish() {
            window.removeEventListener('pointerdown', onDown, true);
            window.removeEventListener('mousedown', onDown, true);
            setTimeout(function () { window.removeEventListener('click', guard); }, 200);
            resolve({ pressed: down !== null, first: first });
          }
          function tick() {
            var now = performance.now();
            if (down !== null) {
              if (first === null && snap(el) !== rest) first = Math.round(now - down);
              if (now - down >= ms) return finish();
            } else if (now - started > 3000) {
              return finish();
            }
            requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        });
        return { armed: true, restless: false };
      });
    },
    result: function () { return state; },
    itemText: itemText,
    itemImages: function (selector) {
      var item = document.querySelector(selector);
      if (!item) return [];
      return Array.prototype.map.call(item.querySelectorAll('img'), function (img) {
        return img.currentSrc || img.src;
      });
    },
  };
  return true;
})()`;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function click(page: Page, x: number, y: number) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await wait(HOLD_MS);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

/** Pauses every request from now on, and never answers them; returns what was asked for. */
async function holdNetwork(page: Page): Promise<{ held: Array<{ url: string; type: string }>; release: () => Promise<void> }> {
  const held: Array<{ url: string; type: string }> = [];
  const stop = page.on('Fetch.requestPaused', (params) => {
    const { request, resourceType } = params as { request: { url: string }; resourceType: string };
    held.push({ url: request.url, type: resourceType });
  });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  return {
    held,
    release: async () => {
      stop();
      await page.send('Fetch.disable');
    },
  };
}

/** Waits until no request has been in flight for half a second, five seconds at most. */
async function settleNetwork(page: Page, inFlight: Set<string>) {
  let quietSince = Date.now();
  for (const started = Date.now(); Date.now() - started < 5000; ) {
    if (inFlight.size > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= 500) return;
    await wait(50);
  }
}

const short = (url: string) => (url.startsWith('data:') ? 'an inline picture' : url.length > 80 ? url.slice(0, 79) + '…' : url);

/** The next check: opens `url` and presses the deck's Next with the network held. */
export async function checkNext(page: Page, url: string, deck: Deck): Promise<string[]> {
  const inFlight = new Set<string>();
  const offs = [
    page.on('Network.requestWillBeSent', (p) => void inFlight.add((p as { requestId: string }).requestId)),
    page.on('Network.loadingFinished', (p) => void inFlight.delete((p as { requestId: string }).requestId)),
    page.on('Network.loadingFailed', (p) => void inFlight.delete((p as { requestId: string }).requestId)),
  ];
  await page.send('Network.enable');
  try {
    await page.open(url);
    await settleNetwork(page, inFlight);
    await page.evaluate(HELPERS);
    const before = await page.evaluate<string | null>(`window.__deck.itemText(${JSON.stringify(deck.item)})`);
    if (before === null) return [`no item matches ${deck.item}`];
    const at = await page.evaluate<{ x: number; y: number } | null>(
      `window.__deck.placeNext(${JSON.stringify(deck.next)})`,
    );
    if (!at) return [`no Next matches ${deck.next}`];

    const network = await holdNetwork(page);
    try {
      await click(page, at.x, at.y);
      let now: string | null = before;
      for (const started = Date.now(); Date.now() - started < NEXT_WAIT_MS; ) {
        now = await page.evaluate<string | null>(`window.__deck.itemText(${JSON.stringify(deck.item)})`);
        if (now && now !== before) break;
        await wait(50);
      }
      if (!now || now === before) {
        return [
          `Next showed nothing new within ${NEXT_WAIT_MS}ms with the network held: ` +
            'the next item is fetched only once Next is pressed',
        ];
      }
      const pictures = new Set(
        await page.evaluate<string[]>(`window.__deck.itemImages(${JSON.stringify(deck.item)})`),
      );
      const late = network.held.filter((r) => r.type === 'Image' && pictures.has(r.url));
      return [...new Set(late.map((r) => r.url))].map(
        (u) => `the next item's picture ${short(u)} is fetched only once Next is pressed`,
      );
    } finally {
      await network.release();
    }
  } finally {
    for (const off of offs) off();
    await page.send('Network.disable');
  }
}

/** The press check: every distinct control and link on `url`, pressed once each on a fresh page. */
export async function checkPress(page: Page, url: string): Promise<string[]> {
  const fresh = async () => {
    await page.open(url, PHONE, { motion: true, settle: 300 });
    await page.evaluate(HELPERS);
  };
  await fresh();
  const all = await page.evaluate<Array<{ index: number; what: string; signature: string }>>(
    'window.__deck.targets()',
  );
  const seen = new Set<string>();
  const targets = all.filter((t) => !seen.has(t.signature) && seen.add(t.signature)).slice(0, MAX_PRESSES);

  const findings: string[] = [];
  let dirty = false;
  for (const target of targets) {
    if (dirty) await fresh();
    dirty = false;
    const at = await page.evaluate<{ x: number; y: number; covered: boolean } | null>(
      `window.__deck.place(${target.index})`,
    );
    // Gone, or under something else: the dock check is what speaks for a covered control.
    if (!at || at.covered) continue;
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
    await wait(HOVER_MS);
    const armed = await page.evaluate<{ armed: boolean; restless: boolean }>(
      `window.__deck.arm(${target.index}, ${PRESS_MS})`,
    );
    // A control already moving at rest cannot be told apart from one answering a press.
    if (!armed.armed) continue;
    const network = await holdNetwork(page);
    dirty = true;
    try {
      await page.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: at.x,
        y: at.y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      });
      await wait(HOLD_MS);
      await page.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: at.x,
        y: at.y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      });
      // A page that went away mid-press showed something: it went.
      const got = await page
        .evaluate<{ pressed: boolean; first: number | null } | null>('window.__deck.result()')
        .catch(() => ({ pressed: true, first: 0 }));
      if (got && got.pressed && got.first === null) {
        findings.push(`${target.what} shows nothing for ${PRESS_MS}ms after it is pressed`);
      }
    } finally {
      await network.release();
    }
  }
  return findings;
}

/** Both deck checks on the deck at `url`. */
export async function checkDeck(page: Page, url: string, deck: Deck): Promise<DeckFindings> {
  const next = await checkNext(page, url, deck);
  const press = await checkPress(page, url);
  return { next, press };
}
