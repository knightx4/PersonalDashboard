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
 * With --record it films instead of photographing (docs/UI-QUALITY-SPEC.md,
 * Part 8). Each surface whose gallery entry declares an `interaction` has it
 * played on the real component at 390px, a frame kept every 50ms for up to a
 * second, and the frames joined into one strip, because a critic that reads
 * pictures cannot watch a video. A surface with no interaction is skipped.
 *
 *   npm run record                              # every declared interaction
 *   npm run record -- news-quick-story          # one surface
 *
 * Strips land in .preview-shots/strips/: `<id>--phone-<theme>.png` is the
 * strip, `<id>--phone-<theme>.json` says what each frame is (its time, what
 * the finger was doing, where it was), and the single frames sit in a folder
 * of the same name. Light only unless SHOOT_THEMES says otherwise.
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
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatTheme, parseTheme, type Theme } from '../lib/theme';
import { themeExpression } from '../lib/preview/theme-expression';
import {
  FRAME_MS,
  frameTimes,
  inputEvents,
  phaseAt,
  pointerAt,
  readInteractions,
  recordLength,
  stripGrid,
  stripName,
  type Box,
  type InputEvent,
  type Interaction,
} from '../lib/preview/interaction';

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

const ALL_WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'laptop', width: 1280, height: 900 },
] as const;

/**
 * Both widths unless told otherwise. A posts run (.claude/skills/posts) wants
 * one picture to attach to a draft, so it asks for one:
 *
 *   SHOOT_WIDTHS=laptop SHOOT_THEMES=light npm run shoot -- dev-plan-tree
 */
const WIDTHS = (() => {
  const asked = process.env.SHOOT_WIDTHS?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!asked || asked.length === 0) return ALL_WIDTHS;
  const known = ALL_WIDTHS.filter((size) => asked.includes(size.name));
  if (known.length !== asked.length) {
    throw new Error(`SHOOT_WIDTHS: use ${ALL_WIDTHS.map((size) => size.name).join(' or ')}`);
  }
  return known;
})();

/**
 * The badge `next dev` draws in the corner. Shots are usually taken against
 * `npm run preview`, a production build with no badge, but a posts run serves
 * the gallery from `next dev` to skip the build, and a screenshot going on X
 * should not carry it.
 */
const HIDE_DEV_BADGE =
  "document.querySelectorAll('nextjs-portal').forEach(function(e){e.remove()});";

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
 *
 * A recording takes light alone by default: motion reads the same in either,
 * and each strip is a second of frames.
 */
const RECORD = process.argv.includes('--record');

const THEMES = (process.env.SHOOT_THEMES ?? (RECORD ? 'light' : 'light,dark'))
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

const applyExpression = themeExpression;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolves once every srcdoc frame has an inline height, or after three seconds. */
const FRAMES_MEASURED = `new Promise((done) => {
  const start = Date.now();
  const check = () => {
    const frames = [...document.querySelectorAll('iframe[srcdoc]')];
    if (frames.every((f) => f.style.height) || Date.now() - start > 3000) done(true);
    else setTimeout(check, 100);
  };
  check();
})`;

type Send = (method: string, params?: Record<string, unknown>) => Promise<Record<string, string>>;

/** Starts headless Chromium and opens a CDP session on its one page. */
async function connect(): Promise<{ send: Send; close: () => void }> {
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
  const send: Send = (method, params = {}) =>
    new Promise<Record<string, string>>((resolve) => {
      const next = ++id;
      pending.set(next, resolve as (value: unknown) => void);
      ws.send(JSON.stringify({ id: next, method, params }));
    });

  await send('Page.enable');
  return {
    send,
    close: () => {
      ws.close();
      chrome.kill();
    },
  };
}

/** Evaluates an expression in the page and returns its value. */
async function evaluate<T>(send: Send, expression: string): Promise<T | undefined> {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return (result as unknown as { result?: { value?: T } }).result?.value;
}

async function main() {
  const only = process.argv.slice(2).find((arg) => !arg.startsWith('--'));

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
  const index = await probe.text();
  const ids = [...index.matchAll(/\/preview\?s=([\w-]+)/g)].map((m) => m[1]!);
  const surfaces = [...new Set(only ? ids.filter((entry) => entry === only) : ids)];
  if (surfaces.length === 0) {
    throw new Error(only ? `No surface named ${only}` : 'The index lists no surfaces.');
  }

  if (RECORD) {
    await recordAll(surfaces, readInteractions(index));
    return;
  }

  mkdirSync(OUT, { recursive: true });
  const { send, close } = await connect();

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
          expression: applyExpression(theme) + HIDE_DEV_BADGE,
        });
        await wait(400);
        // A newsletter frame (app/news/i/[id]/issue-frame.tsx) is 70vh until
        // it has measured itself, and a full-page capture stretches the
        // viewport, so a shot taken before the measurement arrives showed a
        // frame running to the bottom of the page on some takes and not others
        // (plan #1622). Wait, up to three seconds, for every frame to have its
        // own height.
        await send('Runtime.evaluate', {
          expression: FRAMES_MEASURED,
          awaitPromise: true,
        });

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

  close();
  console.log(`\n${shot} shots in .preview-shots/`);
  process.exit(0);
}

/** The phone a recording is played on: 390 wide, at 1x so a second of frames stays small. */
const RECORD_SIZE = { width: 390, height: 844 };

/**
 * The page's animations run at a quarter speed while recording, and frames are
 * taken a quarter as often, so each lands on its true animation time. A
 * capture takes 30 to 70ms here, which at full speed made a second of frames
 * take a second and a half and each frame later than its label. Slowed, a
 * frame is 200ms of wall time apart and capture keeps up.
 *
 * This slows CSS transitions and animations and the Web Animations API, which
 * is how this app moves things. Motion driven by requestAnimationFrame or a
 * timer in script is not slowed and would play four times faster in a strip.
 */
const PLAYBACK = 0.25;

/** Where strips land. */
const STRIPS = join(OUT, 'strips');

/**
 * Stops every form sending while recording. A gallery fixture has nothing
 * behind it, so Quick read's Next form would reach for a server action that
 * fails and paint an error over the last frames of a swipe. The motion up to
 * the send is what is being recorded; what the server does after is not.
 */
const HOLD_FORMS =
  "window.addEventListener('submit',function(e){e.preventDefault();e.stopImmediatePropagation();},true);";

/**
 * A ring drawn where the finger or pointer is, so a strip shows whether the
 * card keeps up with it. It ignores pointer events and so never takes the
 * input it marks.
 */
const FINGER_ID = '__record-finger';
const ADD_FINGER = `(function(){var d=document.createElement('div');d.id='${FINGER_ID}';d.style.cssText='position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid rgba(220,38,38,.9);background:rgba(220,38,38,.18);pointer-events:none;z-index:2147483647;display:none;left:0;top:0';document.body.appendChild(d);})();`;

function placeFinger(point: { x: number; y: number } | null): string {
  return point
    ? `(function(){var d=document.getElementById('${FINGER_ID}');if(d){d.style.display='block';d.style.left='${point.x}px';d.style.top='${point.y}px';}})()`
    : `(function(){var d=document.getElementById('${FINGER_ID}');if(d)d.style.display='none';})()`;
}

/**
 * Plays one input event through CDP: touch for a swipe, mouse for a press.
 *
 * From the third move of a drag on, Chrome held each touchmove back until the
 * next input arrived, so the page got every move one frame late and the strip
 * showed the card trailing the finger by a whole step (plan #1566). Each move
 * is now followed by a copy of itself half a pixel lower: the copy is the one
 * held, and the real move reaches the page in its own frame.
 */
async function dispatch(send: Send, event: InputEvent): Promise<void> {
  if (event.device === 'touch') {
    const type =
      event.phase === 'down' ? 'touchStart' : event.phase === 'move' ? 'touchMove' : 'touchEnd';
    await send('Input.dispatchTouchEvent', {
      type,
      touchPoints: event.phase === 'up' ? [] : [{ x: event.x, y: event.y }],
    });
    if (event.phase === 'move') {
      await send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: event.x, y: event.y + 0.5 }],
      });
    }
    return;
  }
  if (event.phase === 'down') {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: event.x, y: event.y });
  }
  await send('Input.dispatchMouseEvent', {
    type: event.phase === 'down' ? 'mousePressed' : 'mouseReleased',
    x: event.x,
    y: event.y,
    button: 'left',
    clickCount: 1,
  });
}

type Frame = {
  index: number;
  /** When the frame was meant to be taken, in ms from the first. */
  plannedMs: number;
  /**
   * When it was taken, in the page's animation time. Later than planned means
   * capture fell behind.
   */
  actualMs: number;
  /** What the input was doing: at rest, pressed, finger down, dragging, let go. */
  phase: string;
  /** Where the finger was, in viewport pixels, or null when it was up. */
  pointer: { x: number; y: number } | null;
  file: string;
  data: string;
};

/** Records every declared interaction among `surfaces`, skipping the rest. */
async function recordAll(surfaces: string[], interactions: Record<string, Interaction>) {
  const recordable = surfaces.filter((id) => interactions[id]);
  const skipped = surfaces.length - recordable.length;
  if (recordable.length === 0) {
    console.log(
      surfaces.length === 1
        ? `${surfaces[0]} declares no interaction; skipped.`
        : `No surface declares an interaction; ${skipped} skipped.`,
    );
    process.exit(0);
  }

  mkdirSync(STRIPS, { recursive: true });
  const { send, close } = await connect();
  let made = 0;
  for (const surfaceId of recordable) {
    for (const theme of THEMES) {
      const name = await recordOne(send, surfaceId, interactions[surfaceId]!, theme);
      console.log(`  strips/${name}.png`);
      made += 1;
    }
  }
  close();
  console.log(
    `\n${made} strip${made === 1 ? '' : 's'} in .preview-shots/strips/` +
      (skipped
        ? `; ${skipped} surface${skipped === 1 ? '' : 's'} with no interaction skipped`
        : ''),
  );
  process.exit(0);
}

async function recordOne(
  send: Send,
  surfaceId: string,
  interaction: Interaction,
  theme: Theme,
): Promise<string> {
  await send('Emulation.setDeviceMetricsOverride', {
    ...RECORD_SIZE,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await send('Page.navigate', { url: `http://localhost:${PORT}/preview?s=${surfaceId}` });
  await wait(2200);
  await send('Runtime.evaluate', {
    expression: applyExpression(theme) + HIDE_DEV_BADGE + HOLD_FORMS + ADD_FINGER,
  });
  await wait(400);

  // Bring the target on screen when it starts below the fold, and measure it.
  const box = await evaluate<Box | null>(
    send,
    `(function(){var e=document.querySelector(${JSON.stringify(interaction.target)});if(!e)return null;
      var b=e.getBoundingClientRect();if(b.top<0||b.top>innerHeight*0.6){e.scrollIntoView({block:'start'});b=e.getBoundingClientRect();}
      return {x:b.x,y:b.y,width:b.width,height:b.height};})()`,
  );
  if (!box) {
    throw new Error(`${surfaceId}: nothing on the page matches ${interaction.target}`);
  }
  await wait(300);

  const events = inputEvents(interaction, box, RECORD_SIZE.height);
  const times = frameTimes(recordLength(interaction));
  const name = stripName(surfaceId, slug(theme));
  const folder = join(STRIPS, name);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });

  await send('Animation.enable');
  await send('Animation.setPlaybackRate', { playbackRate: PLAYBACK });

  const frames: Frame[] = [];
  let next = 0;
  const start = Date.now();
  for (const [index, plannedMs] of times.entries()) {
    const behind = start + plannedMs / PLAYBACK - Date.now();
    if (behind > 0) await wait(behind);
    while (next < events.length && events[next]!.at <= plannedMs) {
      await dispatch(send, events[next]!);
      next += 1;
    }
    const pointer = pointerAt(events, plannedMs);
    await send('Runtime.evaluate', { expression: placeFinger(pointer) });
    const actualMs = Math.round((Date.now() - start) * PLAYBACK);
    const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    const file = `${String(plannedMs).padStart(4, '0')}ms.jpg`;
    writeFileSync(join(folder, file), Buffer.from(data, 'base64'));
    frames.push({
      index,
      plannedMs,
      actualMs,
      phase: phaseAt(events, plannedMs),
      pointer,
      file: `${name}/${file}`,
      data,
    });
  }
  // Anything left (a release after the last frame) still goes, so the page is
  // never left with a finger down.
  for (; next < events.length; next += 1) await dispatch(send, events[next]!);
  await send('Animation.setPlaybackRate', { playbackRate: 1 });

  await joinStrip(send, name, surfaceId, interaction, theme, frames);
  writeFileSync(
    join(STRIPS, `${name}.json`),
    JSON.stringify(
      {
        surface: surfaceId,
        theme: formatTheme(theme),
        width: RECORD_SIZE.width,
        height: RECORD_SIZE.height,
        frameMs: FRAME_MS,
        interaction,
        target: box,
        strip: `${name}.png`,
        grid: stripGrid(frames.length),
        events,
        frames: frames.map((frame) => ({
          index: frame.index,
          plannedMs: frame.plannedMs,
          actualMs: frame.actualMs,
          phase: frame.phase,
          pointer: frame.pointer,
          file: frame.file,
        })),
      },
      null,
      2,
    ) + '\n',
  );
  return name;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Joins the frames into one image: a heading saying what is recorded and what
 * it should show, then the frames at half size in rows of seven, each with its
 * time and what the input was doing. Drawn by the browser itself, so it needs
 * no image library, and photographed like any other page.
 */
async function joinStrip(
  send: Send,
  name: string,
  surfaceId: string,
  interaction: Interaction,
  theme: Theme,
  frames: Frame[],
): Promise<void> {
  const { columns, rows } = stripGrid(frames.length);
  const cell = RECORD_SIZE.width / 2;
  const imageHeight = RECORD_SIZE.height / 2;
  const gap = 8;
  const pad = 16;
  const header = 64;
  const label = 22;
  const width = pad * 2 + columns * cell + (columns - 1) * gap;
  const height = pad * 2 + header + rows * (imageHeight + label) + (rows - 1) * gap;

  const cells = frames
    .map(
      (frame) =>
        `<figure><img src="data:image/jpeg;base64,${frame.data}"><figcaption>${frame.actualMs}ms · ${escapeHtml(frame.phase)}</figcaption></figure>`,
    )
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0}
    body{background:#fff;color:#111;font:13px/1.3 system-ui,sans-serif;padding:${pad}px;width:${width}px}
    header{height:${header}px}
    h1{font-size:15px;font-weight:600}
    p{color:#444;margin-top:4px}
    main{display:grid;grid-template-columns:repeat(${columns},${cell}px);gap:${gap}px}
    figure{width:${cell}px}
    img{display:block;width:${cell}px;height:${imageHeight}px;outline:1px solid #ccc}
    figcaption{height:${label}px;padding-top:4px;font-size:11px;color:#333;white-space:nowrap}
  </style></head><body>
    <header><h1>${escapeHtml(surfaceId)} · ${interaction.kind}${interaction.kind === 'swipe' ? ` ${interaction.direction}` : ''} · ${escapeHtml(formatTheme(theme) ?? '')} · ${frames.length} frames, ${FRAME_MS}ms apart</h1>
    <p>Should show: ${escapeHtml(interaction.shows)}</p></header>
    <main>${cells}</main></body></html>`;

  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: 'about:blank' });
  await wait(300);
  await evaluate(
    send,
    `(function(){document.open();document.write(${JSON.stringify(html)});document.close();
      return Promise.all([].map.call(document.images,function(i){return i.decode();})).then(function(){return true;});})()`,
  );
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  writeFileSync(join(STRIPS, `${name}.png`), Buffer.from(data, 'base64'));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
