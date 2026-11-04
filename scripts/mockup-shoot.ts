/**
 * Photograph a mockup file for a plan question (plan #2810.3).
 *
 * Opens the HTML file in the installed Chromium at 390 and 1280 wide and
 * returns a PNG per element marked data-option="A", "B" and so on, or of the
 * whole page when no element is marked. Used by scripts/plan.ts; it writes
 * nothing itself.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MOCKUP_WIDTHS, optionLettersIn, type MockupWidth } from '../lib/plan/mockups';

export type MockupShot = { optionLetter: string | null; width: MockupWidth; png: Buffer };

function findChrome(): string {
  if (process.env.SHOOT_CHROME) return process.env.SHOOT_CHROME;
  const root = '/opt/pw-browsers';
  if (existsSync(root)) {
    const builds = readdirSync(root)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const build of builds) {
      for (const dir of ['chrome-linux64', 'chrome-linux']) {
        const path = join(root, build, dir, 'chrome');
        if (existsSync(path)) return path;
      }
    }
  }
  for (const path of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (existsSync(path)) return path;
  }
  throw new Error('No Chromium found. Set SHOOT_CHROME to one.');
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Reply = { result?: Record<string, unknown>; error?: { message: string } };

export async function shootMockup(htmlFile: string, optionLetters: string[]): Promise<MockupShot[]> {
  const port = 9600 + Math.floor(Math.random() * 300);
  const chrome = spawn(
    findChrome(),
    ['--headless=new', `--remote-debugging-port=${port}`, '--no-sandbox', '--disable-gpu', '--hide-scrollbars', 'about:blank'],
    { stdio: 'ignore' },
  );
  try {
    let page: { webSocketDebuggerUrl: string } | undefined;
    for (let attempt = 0; attempt < 30 && !page; attempt++) {
      await wait(300);
      try {
        const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
          type: string;
          webSocketDebuggerUrl: string;
        }>;
        page = targets.find((t) => t.type === 'page');
      } catch {
        // Not up yet.
      }
    }
    if (!page) throw new Error('Chromium did not start.');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => {
      ws.onopen = r;
    });
    let id = 0;
    const pending = new Map<number, (value: Reply) => void>();
    ws.onmessage = (event) => {
      const data = JSON.parse(String(event.data)) as Reply & { id?: number };
      if (data.id && pending.has(data.id)) {
        pending.get(data.id)!(data);
        pending.delete(data.id);
      }
    };
    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<Record<string, unknown>>((resolveReply, reject) => {
        const next = ++id;
        pending.set(next, (reply) =>
          reply.error ? reject(new Error(`${method}: ${reply.error.message}`)) : resolveReply(reply.result ?? {}),
        );
        ws.send(JSON.stringify({ id: next, method, params }));
      });

    await send('Page.enable');
    const url = pathToFileURL(resolve(htmlFile)).href;
    const shots: MockupShot[] = [];
    for (const width of MOCKUP_WIDTHS) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width < 600,
      });
      await send('Page.navigate', { url });
      await wait(900);
      const targets = optionLetters.length > 0 ? optionLetters : [null];
      for (const letter of targets) {
        const expression =
          letter === null
            ? `({ x: 0, y: 0, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })`
            : `(() => { const el = document.querySelector('[data-option="${letter}"]'); if (!el) return null;
                 const r = el.getBoundingClientRect();
                 return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`;
        const evaluated = (await send('Runtime.evaluate', { expression, returnByValue: true })) as {
          result?: { value?: { x: number; y: number; width: number; height: number } | null };
        };
        const box = evaluated.result?.value;
        if (!box || box.width < 1 || box.height < 1) {
          throw new Error(`Option ${letter} has no visible element with data-option at ${width} wide.`);
        }
        const shot = (await send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: true,
          clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 6000), scale: 1 },
        })) as { data?: string };
        if (!shot.data) throw new Error('Chromium returned no picture.');
        shots.push({ optionLetter: letter, width, png: Buffer.from(shot.data, 'base64') });
      }
    }
    ws.close();
    return shots;
  } finally {
    chrome.kill();
  }
}

export { optionLettersIn };
