import type { HandoffBrowser } from './handoffs';

/**
 * Which browser a session hand-off drove, and why (plan #3040.2).
 *
 * A bot marks a session hand-off as a browser task (browser_task, plan
 * #3040.1). The session working it takes Claude in Chrome when its tools are
 * offered, which happens only where Claude runs on the person's own computer
 * (docs/HANDOFF-BROWSER.md), and a headless Chromium with none of their
 * sign-ins otherwise. When the page needs a sign-in and Chrome is not there,
 * it uses neither and says so. Before it closes, the session records the
 * route on the row (`handoff-session.ts browser`), so the bot can tell the
 * person which browser did the work. The route words here are the ones the
 * session passes; the row keeps chrome, headless or null.
 *
 * This file is the part with no database: reading the route the session
 * gives, the statement that records it, the check that holds a close until
 * it is recorded, and how a page read headless is judged to want a sign-in.
 */

/** What the session says it did: one of the two browsers, or neither. */
export type BrowserRoute = HandoffBrowser | 'none';

export const BROWSER_ROUTES: readonly BrowserRoute[] = ['chrome', 'headless', 'none'];

/** dash_handoffs_browser_reason_ck holds the reason to 500 characters. */
export const MAX_BROWSER_REASON = 500;

/**
 * The values for BROWSER_SQL's $3 and $4, or why they cannot be written. A
 * route of `none` keeps browser null and the reason alone, which is how the
 * row says no browser could be used.
 */
export function browserChoice(
  route: string | null,
  reason: string | null,
): { ok: true; browser: HandoffBrowser | null; reason: string } | { ok: false; error: string } {
  const picked = BROWSER_ROUTES.find((each) => each === route?.trim().toLowerCase());
  if (!picked) return { ok: false, error: '--route takes chrome, headless or none.' };
  const why = reason?.replace(/\s+/g, ' ').trim() ?? '';
  if (!why) {
    return {
      ok: false,
      error: '--reason "<why this browser, in a sentence the bot can pass on>" is needed with every route.',
    };
  }
  if (why.length > MAX_BROWSER_REASON) return { ok: false, error: `--reason is over ${MAX_BROWSER_REASON} characters.` };
  return { ok: true, browser: picked === 'none' ? null : picked, reason: why };
}

/**
 * Records the route on an open session hand-off. $1 id, $2 owner, $3 browser
 * (chrome, headless or null), $4 the reason. Run again, it replaces the
 * route, so a session that starts headless and finds a sign-in wall can say
 * so.
 */
export const BROWSER_SQL = `update core.dash_handoffs
    set browser = $3, browser_reason = $4, last_seen_at = now()
  where id = $1 and user_id = $2 and kind = 'session' and status in ('pending', 'fired')
  returning id, browser_task, browser, browser_reason`;

/** The browser columns of a hand-off, as THREAD_SQL reads them. */
export type BrowserState = {
  browserTask: boolean;
  browser: HandoffBrowser | null;
  browserReason: string | null;
};

/**
 * Why a done close of a browser task must wait, or null. The route goes on
 * the row before the hand-off closes, so the bot and the hand-off's page can
 * say which browser did it. A failure may close without one: its reason is
 * told in the thread either way.
 */
export function browserCloseRefusal(state: BrowserState | null | undefined, done: boolean): string | null {
  if (!done || !state?.browserTask) return null;
  if (state.browser || state.browserReason) return null;
  return 'A browser task records its route before it closes: npx tsx scripts/handoff-session.ts browser <id> --route chrome|headless|none --reason "<why>".';
}

/** What scripts/browse.ts reads off a page to judge whether it wants a sign-in. */
export type PageSignals = {
  url: string;
  /** Visible password inputs on the page. */
  passwordFields: number;
};

/** A host that only signs people in: login.microsoftonline.com, accounts.google.com. */
const SIGN_IN_HOST = /^(login|signin|auth|sso|accounts)\./i;
/** A path to a sign-in page: /login, /users/sign_in, /session/new, /sso/start. */
const SIGN_IN_PATH = /\/(log-?in|sign-?in|sign_in|auth|sso|session\/new)(\/|\.|$)/i;

/**
 * Whether a page read headless is asking for a sign-in: a visible password
 * box, or a redirect to a login, sign-in or SSO address. The headless
 * browser has none of the person's sign-ins, so a page like this is where
 * the session stops and asks for Chrome instead of going on.
 */
export function signInWall(page: PageSignals): boolean {
  if (page.passwordFields > 0) return true;
  try {
    const url = new URL(page.url);
    return SIGN_IN_HOST.test(url.hostname) || SIGN_IN_PATH.test(url.pathname);
  } catch {
    return false;
  }
}
