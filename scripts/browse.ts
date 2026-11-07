/**
 * Reads a public web page in a headless Chromium, for a browser task a
 * session hand-off takes when Claude in Chrome is not there (plan #3040.2,
 * .claude/skills/dash-backup/SKILL.md, "A browser task").
 *
 *   npx tsx scripts/browse.ts <url>
 *   npx tsx scripts/browse.ts <url> --eval "<js>" [--eval "<js>"]… [--wait <ms>] [--shot <file.png>] [--phone]
 *
 * It opens the page wide (1280 by 900, or a phone with --phone), runs each
 * --eval in the page in order, waiting --wait milliseconds after each (1000
 * when left out) so a click can load what it opens, and prints JSON: the
 * address it ended on, the title, whether the page wants a sign-in
 * (signInWall, lib/talk/handoff-browser.ts), each --eval's value, and the
 * page's text up to --chars characters (8000 when left out). --shot saves a
 * screenshot.
 *
 * The Chromium is the one Playwright left under PLAYWRIGHT_BROWSERS_PATH,
 * driven over the DevTools protocol as the phone checks drive it
 * (tests/interaction/browser.ts), so no browser service is paid for. Its
 * profile is thrown away each run: it holds none of the person's sign-ins
 * and keeps nothing afterwards, passwords included.
 */
import { writeFileSync } from 'node:fs';
import { signInWall } from '../lib/talk/handoff-browser';
import { chromePath, launch } from '../tests/interaction/browser';

const WIDE = { width: 1280, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function value(args: string[], at: number, name: string): string {
  const next = args[at + 1];
  if (next === undefined || next.startsWith('--')) fail(`${name} needs a value.`);
  return next;
}

function parse(args: string[]) {
  const options = { url: '', evals: [] as string[], wait: 1000, shot: null as string | null, phone: false, chars: 8000 };
  for (let at = 0; at < args.length; at++) {
    const arg = args[at];
    if (arg === '--eval') options.evals.push(value(args, at++, arg));
    else if (arg === '--wait') options.wait = Number(value(args, at++, arg));
    else if (arg === '--chars') options.chars = Number(value(args, at++, arg));
    else if (arg === '--shot') options.shot = value(args, at++, arg);
    else if (arg === '--phone') options.phone = true;
    else if (arg.startsWith('--')) fail(`Unknown option ${arg}.`);
    else if (options.url) fail('One address at a time.');
    else options.url = arg;
  }
  if (!/^https?:\/\//i.test(options.url)) {
    fail('Usage: browse.ts <http(s) address> [--eval "<js>"]… [--wait <ms>] [--shot <file.png>] [--phone] [--chars <n>]');
  }
  if (!Number.isFinite(options.wait) || options.wait < 0) fail('--wait takes milliseconds.');
  if (!Number.isFinite(options.chars) || options.chars < 0) fail('--chars takes a number.');
  return options;
}

const SIGNALS = `({
  url: location.href,
  title: document.title,
  passwordFields: Array.from(document.querySelectorAll('input[type=password]'))
    .filter(function (el) { return el.offsetParent !== null; }).length,
  text: (document.body ? document.body.innerText : '')
})`;

async function main() {
  const options = parse(process.argv.slice(2));
  if (!chromePath()) fail('No headless Chromium here (PLAYWRIGHT_BROWSERS_PATH). This route cannot run.');
  const browser = await launch();
  try {
    await browser.page.open(options.url, options.phone ? PHONE : WIDE);
    const results: unknown[] = [];
    for (const expression of options.evals) {
      results.push(await browser.page.evaluate(expression));
      await new Promise((resolve) => setTimeout(resolve, options.wait));
    }
    const page = await browser.page.evaluate<{ url: string; title: string; passwordFields: number; text: string }>(
      SIGNALS,
    );
    if (options.shot) {
      const { data } = await browser.page.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      writeFileSync(options.shot, Buffer.from(data, 'base64'));
    }
    const text = page.text.replace(/\n{3,}/g, '\n\n').trim();
    console.log(
      JSON.stringify(
        {
          url: page.url,
          title: page.title,
          signInWall: signInWall(page),
          evals: results,
          text: text.length > options.chars ? `${text.slice(0, options.chars)} [cut]` : text,
          ...(options.shot ? { shot: options.shot } : {}),
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
