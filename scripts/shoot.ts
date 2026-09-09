/**
 * Photograph every surface, at every width, in every theme.
 *
 *   UI_PREVIEW=1 npm run build
 *   UI_PREVIEW=1 PORT=3400 npm run start &
 *   npx tsx scripts/shoot.ts                    # everything
 *   npx tsx scripts/shoot.ts jobs-role-timeline # one surface
 *
 * Shots land in .preview-shots/, which is gitignored. Nothing here ships.
 *
 * This exists because five sweeps ran on evidence that was not evidence.
 * Each one hand-wrote markup resembling a surface, shot that, and reported on
 * the app -- and a drawing agrees with whoever drew it. Meanwhile the thing a
 * person actually looks at, on a phone, kept a caption above a box whose
 * placeholder said the same words. That gap is what this closes: the real
 * component, at 390px, where the crowding is.
 *
 * 390 is an iPhone; 1280 is a laptop. Both, always, because a surface judged
 * at one is not judged. A form nobody would draw on a phone gets drawn on a
 * phone by being designed at 1280.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = process.env.PREVIEW_PORT ?? '3400';
const OUT = join(process.cwd(), '.preview-shots');
const PROBE = 9500;

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'laptop', width: 1280, height: 900 },
] as const;

/** Paper and Ink: the two poles. A surface right in both is right in Dusk. */
const THEMES = ['paper', 'ink'] as const;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const only = process.argv[2];

  // The status, not the body. Checking the HTML for the string "404" was the
  // first version of this and it matched the framework's own markup, so a
  // working server looked broken.
  const probe = await fetch(`http://localhost:${PORT}/preview`);
  if (probe.status === 404) {
    throw new Error(`The preview route 404s on :${PORT}. Build with UI_PREVIEW=1.`);
  }
  if (!probe.ok) {
    throw new Error(`No preview server on :${PORT} (HTTP ${probe.status}).`);
  }

  // The list comes off the rendered index rather than from importing the
  // module: app/preview/surfaces.tsx pulls in client components, which a Node
  // script cannot load. Reading it from the server is better than a second
  // list anyway -- what gets shot is exactly what the server offers, so the
  // two cannot drift.
  const ids = [...(await probe.text()).matchAll(/\/preview\?s=([\w-]+)/g)].map((m) => m[1]!);
  const surfaces = [...new Set(only ? ids.filter((entry) => entry === only) : ids)];
  if (surfaces.length === 0) {
    throw new Error(only ? `No surface named ${only}` : 'The index lists no surfaces.');
  }

  mkdirSync(OUT, { recursive: true });

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      // The browser's locale, not the page's. A `type="date"` input takes its
      // format from the browser UI language and ignores `<html lang>` -- so a
      // default headless Chromium drew every date field as `mm/dd/yyyy` and
      // sent a reader hunting for a US-format bug in an app that has none.
      // en-GB is where this app is used; it makes the shots honest.
      '--lang=en-GB',
      `--remote-debugging-port=${PROBE}`,
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      'about:blank',
    ],
    // `--lang` alone is not enough on Linux: Chromium reads the locale off the
    // environment as well, and a date input drawn `mm/dd/yyyy` under a shot of
    // an app used in London is a bug report about nothing.
    { stdio: 'ignore', env: { ...process.env, LANG: 'en_GB.UTF-8', LANGUAGE: 'en_GB' } },
  );
  await wait(3500);

  const targets = (await (await fetch(`http://127.0.0.1:${PROBE}/json/list`)).json()) as Array<{
    type: string;
    webSocketDebuggerUrl: string;
  }>;
  const ws = new WebSocket(targets.find((t) => t.type === 'page')!.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map<number, (value: unknown) => void>();
  ws.onmessage = (event) => {
    const data = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)!(data.result);
      pending.delete(data.id);
    }
  };
  await new Promise((r) => {
    ws.onopen = r;
  });
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, string>>((resolve) => {
      const next = ++id;
      pending.set(next, resolve as (value: unknown) => void);
      ws.send(JSON.stringify({ id: next, method, params }));
    });

  await send('Page.enable');

  let shot = 0;
  for (const surfaceId of surfaces) {
    for (const size of WIDTHS) {
      for (const theme of THEMES) {
        await send('Emulation.setDeviceMetricsOverride', {
          width: size.width,
          height: size.height,
          deviceScaleFactor: 2,
          mobile: size.name === 'phone',
        });
        await send('Page.navigate', { url: `http://localhost:${PORT}/preview?s=${surfaceId}` });
        await wait(2200);
        await send('Runtime.evaluate', {
          expression: `document.documentElement.setAttribute('data-theme','${theme}')`,
        });
        await wait(400);
        const { data } = await send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: true,
        });
        const name = `${surfaceId}--${size.name}-${theme}.png`;
        writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
        console.log(`  ${name}`);
        shot += 1;
      }
    }
  }

  ws.close();
  chrome.kill();
  console.log(`\n${shot} shots in .preview-shots/`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
