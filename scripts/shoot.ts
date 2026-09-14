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
import { formatTheme, parseTheme, type Theme } from '../lib/theme';
import { themeAttribute, themeStyle } from '../lib/theme/apply';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = process.env.PREVIEW_PORT ?? '3400';
const OUT = join(process.cwd(), '.preview-shots');
const PROBE = 9500;

/**
 * What a full-page capture can survive, measured rather than looked up.
 *
 * `captureBeyondViewport` past the browser's limits does not fail -- it never
 * answers, and a hung capture wedges the CDP session for good, so every shot
 * after it hangs too and the script sits there printing nothing. It looks
 * exactly like a dead server, which is how it cost an hour.
 *
 * Two limits, both real, found by measuring this app's own longest page:
 * 780x21024 hung on the height, and 2560x12776 hung with both sides well under
 * that, so area binds first. The largest capture known to work here is
 * 2560x5262 = 13.5Mpx, so the budget is 14. Anything over drops to 1x, which
 * is a smaller picture of the whole page rather than no picture at all.
 */
const MAX_SIDE = 16_384;
const MAX_AREA = 14_000_000;

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'laptop', width: 1280, height: 900 },
] as const;

/**
 * Light and dark with no colour by default: the two poles, and a surface right
 * in both is right in a coloured one. Shooting more doubles a run for a
 * difference that is usually nothing.
 *
 * Any stored theme value works, because these are read the way the app reads
 * them -- a written theme's name, a mode, or a mode and a hue:
 *
 *   SHOOT_THEMES=lightbox npm run shoot -- <surface>
 *   SHOOT_THEMES=light,dark:284 npm run shoot -- <surface>
 *
 * A theme nobody can photograph is a theme nobody can judge, and since #420
 * the set of them is the whole circle.
 */
const THEMES = (process.env.SHOOT_THEMES ?? 'light,dark')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => {
    const theme = parseTheme(value);
    if (theme.kind === 'system') {
      throw new Error(`SHOOT_THEMES: ${value} is not a theme this app can read`);
    }
    return theme;
  });

/** A theme's name, safe to put in a filename: `dark:284` is `dark-284`. */
function slug(theme: Theme): string {
  return (formatTheme(theme) ?? 'system').replace(':', '-');
}

/**
 * The expression that puts a theme on the page, built here rather than there.
 *
 * The browser has no module loader in a CDP evaluate, so the palette is
 * generated in Node and the values travel as literals. Same two halves the
 * root layout writes: the attribute for the polarity, the tokens for the
 * colour.
 */
function applyExpression(theme: Theme): string {
  const attribute = themeAttribute(theme);
  const style = themeStyle(theme) ?? {};
  const declarations = Object.entries(style)
    .map(([token, value]) => `${token}:${value}`)
    .join(';');

  return [
    'var r=document.documentElement;',
    attribute ? `r.setAttribute('data-theme','${attribute}');` : "r.removeAttribute('data-theme');",
    `r.setAttribute('style',${JSON.stringify(declarations)});`,
  ].join('');
}

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
    {
      stdio: 'ignore',
      env: { ...process.env, LANG: 'en_GB.UTF-8', LANGUAGE: 'en_GB' },
    },
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
    const data = JSON.parse(String(event.data)) as {
      id?: number;
      result?: unknown;
    };
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
        await send('Page.navigate', {
          url: `http://localhost:${PORT}/preview?s=${surfaceId}`,
        });
        await wait(2200);
        await send('Runtime.evaluate', {
          expression: applyExpression(theme),
        });
        await wait(400);

        // Measure before capturing, and drop to 1x if a 2x shot would exceed
        // what this browser can allocate. See MAX_SIDE / MAX_AREA above: over
        // either, the capture never returns and takes the whole run with it.
        const measured = await send('Runtime.evaluate', {
          expression: 'document.documentElement.scrollHeight',
          returnByValue: true,
        });
        const pageHeight = Number(
          (measured as unknown as { result?: { value?: number } }).result?.value ?? size.height,
        );
        const fits = (factor: number) =>
          size.width * factor <= MAX_SIDE &&
          pageHeight * factor <= MAX_SIDE &&
          size.width * factor * pageHeight * factor <= MAX_AREA;
        const scale = fits(2) ? 2 : 1;
        if (scale === 1) {
          await send('Emulation.setDeviceMetricsOverride', {
            width: size.width,
            height: size.height,
            deviceScaleFactor: 1,
            mobile: size.name === 'phone',
          });
          console.log(`  (${surfaceId} is ${pageHeight}px tall — shooting at 1x)`);
        }

        const { data } = await send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: true,
        });
        const name = `${surfaceId}--${size.name}-${slug(theme)}.png`;
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
