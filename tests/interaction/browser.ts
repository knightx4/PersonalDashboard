/**
 * A headless Chromium the phone checks drive, spoken to over the DevTools
 * protocol.
 *
 * There is no Playwright package in this repository, only the browsers it
 * downloads, so this talks to Chromium the way scripts/shoot.ts does: start
 * it, open a websocket on its one page, send commands. Unlike shoot.ts it asks
 * for a free debugging port and a throwaway profile, so the gate can run it
 * while a preview server and a shoot are running in another terminal.
 *
 * Kept small and general on purpose. The four checks in ./checks.ts use
 * `open` and `evaluate`; the deck checks in ./deck.ts use `send` for input
 * and network events, `on` to hear them, and open the page with motion on.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** An iPhone's viewport, the width every phone check is made at. */
export const PHONE = { width: 390, height: 844 } as const;

const BROWSERS = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';

/**
 * The Chromium to run: PHONE_CHROME when set, else the newest one Playwright
 * left in its browsers folder, else null where there is none (a CI runner).
 */
export function chromePath(): string | null {
  const asked = process.env.PHONE_CHROME;
  if (asked) return existsSync(asked) ? asked : null;
  if (!existsSync(BROWSERS)) return null;
  const builds = readdirSync(BROWSERS)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const build of builds) {
    const path = join(BROWSERS, build, 'chrome-linux', 'chrome');
    if (existsSync(path)) return path;
  }
  return null;
}

type Message = { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };

export type Page = {
  /** Sends one DevTools command and resolves with its result. */
  send: <T = Record<string, unknown>>(method: string, params?: Record<string, unknown>) => Promise<T>;
  /** Listens for a DevTools event; returns the function that stops listening. */
  on: (method: string, listener: (params: unknown) => void) => () => void;
  /** Evaluates an expression in the page, awaiting a promise, and returns its value. */
  evaluate: <T>(expression: string) => Promise<T>;
  /**
   * Loads `url` at phone size (or `size`), waits for the load event, the
   * fonts and a moment for the client components to mount, with motion
   * reduced so nothing is caught halfway through a fade.
   */
  open: (url: string, size?: { width: number; height: number }, options?: OpenOptions) => Promise<void>;
};

export type OpenOptions = {
  /**
   * Leave motion as a person without reduced motion has it, transitions
   * running, and wait for the page's entrance animations to finish instead
   * of cutting them short. The press check needs this: the app's pressed
   * state is a transition, and it drops out under reduced motion.
   */
  motion?: boolean;
  /** How long to wait after the fonts, in milliseconds (600 when left out). */
  settle?: number;
};

export type Browser = { page: Page; close: () => Promise<void> };

const STILL =
  '*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important}';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for `path` to exist and hold a line, which is how Chromium says its port. */
async function readPort(path: string, child: ChildProcess): Promise<number> {
  for (let tries = 0; tries < 200; tries++) {
    if (child.exitCode !== null) throw new Error(`Chromium exited with ${child.exitCode}`);
    if (existsSync(path)) {
      const port = Number(readFileSync(path, 'utf8').split('\n')[0]);
      if (port > 0) return port;
    }
    await wait(50);
  }
  throw new Error('Chromium did not open a debugging port within ten seconds');
}

/** Starts headless Chromium and opens a session on its page. */
export async function launch(): Promise<Browser> {
  const chrome = chromePath();
  if (!chrome) throw new Error(`No Chromium under ${BROWSERS}; set PHONE_CHROME to one.`);
  const profile = mkdtempSync(join(tmpdir(), 'phone-checks-'));
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--lang=en-GB',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      'about:blank',
    ],
    { stdio: 'ignore', env: { ...process.env, LANG: 'en_GB.UTF-8', LANGUAGE: 'en_GB' } },
  );

  const close = async () => {
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve(null);
      else child.once('exit', resolve);
    });
    try {
      // Chromium's helpers can still be writing as it goes, so give it a moment.
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // A profile left in the temp folder is not worth failing a check over.
    }
  };

  try {
    const port = await readPort(join(profile, 'DevToolsActivePort'), child);
    let target: { type: string; webSocketDebuggerUrl: string } | undefined;
    for (let tries = 0; tries < 50 && !target; tries++) {
      const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
        type: string;
        webSocketDebuggerUrl: string;
      }>;
      target = list.find((entry) => entry.type === 'page');
      if (!target) await wait(100);
    }
    if (!target) throw new Error('Chromium opened no page');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let next = 0;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    const listeners = new Map<string, Set<(params: unknown) => void>>();
    ws.onmessage = (event) => {
      const data = JSON.parse(String(event.data)) as Message;
      if (data.id !== undefined) {
        const waiting = pending.get(data.id);
        pending.delete(data.id);
        if (!waiting) return;
        if (data.error) waiting.reject(new Error(JSON.stringify(data.error)));
        else waiting.resolve(data.result);
      } else if (data.method) {
        for (const listener of listeners.get(data.method) ?? []) listener(data.params);
      }
    };

    const send: Page['send'] = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++next;
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });

    const on: Page['on'] = (method, listener) => {
      const set = listeners.get(method) ?? new Set();
      set.add(listener);
      listeners.set(method, set);
      return () => set.delete(listener);
    };

    const evaluate: Page['evaluate'] = async <T>(expression: string) => {
      const reply = await send<{
        result?: { value?: T };
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (reply.exceptionDetails) {
        const detail = reply.exceptionDetails;
        throw new Error(detail.exception?.description ?? detail.text ?? 'evaluate failed');
      }
      return reply.result?.value as T;
    };

    const open: Page['open'] = async (url, size = PHONE, options = {}) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width: size.width,
        height: size.height,
        deviceScaleFactor: 2,
        mobile: size.width < 1024,
      });
      await send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: options.motion ? 'no-preference' : 'reduce' }],
      });
      const loaded = new Promise<void>((resolve) => {
        const stop = on('Page.loadEventFired', () => {
          stop();
          resolve();
        });
      });
      const nav = await send<{ errorText?: string }>('Page.navigate', { url });
      if (nav.errorText) throw new Error(`${url}: ${nav.errorText}`);
      await Promise.race([loaded, wait(15_000)]);
      await evaluate(
        `document.fonts.ready.then(function(){return new Promise(function(r){setTimeout(r,${options.settle ?? 600})})})`,
      );
      if (options.motion) {
        // Entrance animations run out, up to two seconds; a looping one is left looping.
        await evaluate(
          `Promise.race([Promise.all(document.getAnimations().filter(function(a){var t=a.effect&&a.effect.getComputedTiming();return t&&t.iterations!==Infinity}).map(function(a){return a.finished.catch(function(){})})),new Promise(function(r){setTimeout(r,2000)})]).then(function(){return true})`,
        );
        return;
      }
      // Transitions off, and animations straight to their end, so a theme
      // put on afterwards is measured where it lands rather than on its way.
      await evaluate(
        `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(STILL)};document.head.appendChild(s);return true})()`,
      );
    };

    await send('Page.enable');
    await send('Runtime.enable');
    return {
      page: { send, on, evaluate, open },
      close: async () => {
        ws.close();
        await close();
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
