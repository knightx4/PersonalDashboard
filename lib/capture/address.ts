import { z } from 'zod';
import { fileCaptureParts, type CaptureWriters } from '@/lib/capture/file';
import { goalsPlaceName } from '@/lib/capture/destination';
import type { FiledCapture } from '@/lib/capture/place';
import {
  CAPTURE_PLACES,
  type CapturePart,
  type CapturePlace,
  type CaptureSort,
} from '@/lib/capture/sort';
import { isCaptureTokenShape, type CaptureTokenCheck } from '@/lib/capture/tokens';
import { CAPTURE_BODY_MAX } from '@/lib/goals/capture';

/**
 * The capture address (plan #1706, docs/INPUT-CHANNELS.md): `POST
 * /api/capture`, which a Siri Shortcut or another tool holding a personal
 * capture token calls to add something without a browser sign-in.
 *
 * It takes `{ text, url?, place? }` and files it as the one capture box
 * does, through the same writers (lib/capture/file.ts), so every filing is a
 * Dash action with an Undo on Home. With `place` it files straight there;
 * without one the capture sorter decides. The reply is JSON whose `spoken`
 * field is one short sentence a Shortcut can speak.
 *
 * This file has no client in it: the token check, the account's places, the
 * sorter and the writers are passed in, so every refusal and every filing is
 * tested without a database. lib/capture/address-server.ts binds them to the
 * service-role clients, for the user id the token check returned.
 */

/** The most a request body may be, in bytes: the text, a link and the JSON around them. */
export const CAPTURE_REQUEST_MAX_BYTES = 24_000;
/** The longest link a capture carries. */
export const CAPTURE_URL_MAX = 2_000;

/** What the address needs for one account, once the token has named it. */
export type CaptureAccount = {
  /** The places this account can file into (offeredCapturePlaces). */
  places: readonly CapturePlace[];
  /** One sorter call among `places`; null when no sort could be made. */
  sort: (sentence: string, places: readonly CapturePlace[]) => Promise<CaptureSort | null>;
  /** The capture box's writers, bound to this account. */
  writers: CaptureWriters;
};

export type CaptureAddressDeps = {
  /** checkCaptureToken, which counts the capture against the token's limit. Throws when the database cannot be reached. */
  check: (token: string | null) => Promise<CaptureTokenCheck>;
  account: (userId: string) => Promise<CaptureAccount>;
};

export type CaptureAddressRequest = {
  /** The token, from the Authorization header (tokenFromAuthorization). */
  token: string | null;
  /** The Content-Length header, when one was sent. */
  contentLength: string | null;
  /** The raw body. */
  body: string;
};

export type CaptureFiledItem = Pick<FiledCapture, 'place' | 'where' | 'href' | 'actionId'>;

export type CaptureAddressBody =
  | {
      ok: true;
      /** One short sentence for the caller to speak or show. */
      spoken: string;
      filed: CaptureFiledItem[];
      /** Why a part was not filed, when the sentence was split and one part failed. */
      errors: string[];
      /** True when no place was given, Dash could not tell, and it was kept as a todo. */
      unsure: boolean;
    }
  | {
      ok: false;
      error: CaptureAddressError;
      spoken: string;
    };

export type CaptureAddressError =
  | CaptureTokenReason
  | 'too_long'
  | 'bad_request'
  | 'place_off'
  | 'not_filed'
  | 'unavailable';

type CaptureTokenReason = Extract<CaptureTokenCheck, { ok: false }>['reason'];

export type CaptureAddressReply = {
  status: number;
  headers: Record<string, string>;
  body: CaptureAddressBody;
};

const UNAVAILABLE = 'Dash could not file that just now. Try again in a minute.';

const Body = z.object({
  text: z.string().optional(),
  url: z.string().trim().max(CAPTURE_URL_MAX).optional().nullable(),
  place: z.string().trim().toLowerCase().optional().nullable(),
});

function refuse(status: number, error: CaptureAddressError, spoken: string, headers: Record<string, string> = {}): CaptureAddressReply {
  return { status, headers, body: { ok: false, error, spoken } };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** How the reply names the places the account can use: "todo, goals or jobs". */
function placeList(places: readonly CapturePlace[]): string {
  if (places.length <= 1) return places.join('');
  return `${places.slice(0, -1).join(', ')} or ${places[places.length - 1]}`;
}

/** The part of "Job search · Product Analyst at Stripe" after the workspace. */
function inside(where: string): string {
  const at = where.indexOf(' · ');
  return at === -1 ? '' : where.slice(at + 3);
}

/** One filed part, as a sentence a Shortcut can speak. */
function spokenPart(item: FiledCapture): string {
  switch (item.place) {
    case 'todo':
      return 'Added to your todos for today.';
    case 'goals': {
      const name = item.goals ? goalsPlaceName(item.goals.entries) : inside(item.where);
      if (!name || name === 'Home') return 'Kept in Goals. It did not match any of your goals.';
      if (/^\d+ goals$/.test(name)) return `Logged against ${name}.`;
      return `Logged against your goal ${name}.`;
    }
    case 'jobs': {
      const role = inside(item.where);
      return role ? `Added a note on ${role}.` : 'Added a note to your job search.';
    }
    case 'vault':
      return "Kept in your vault's Inbox.";
  }
}

/** What the reply says once something was filed. */
export function spokenFiled(filed: readonly FiledCapture[], errors: readonly string[], unsure: boolean): string {
  const said =
    unsure && filed.length === 1 && filed[0].place === 'todo'
      ? 'Dash was not sure where this goes, so it is a todo for today.'
      : filed.map(spokenPart).join(' ');
  return errors.length > 0 ? `${said} ${errors[0]}` : said;
}

/**
 * The sentence filed: the text, and the link on its own line after it. A
 * link sent with no text (a page shared from Safari) is the sentence alone.
 */
export function captureSentence(text: string, url: string | null): string {
  if (!url) return text;
  return text ? `${text}\n${url}` : url;
}

/** Answer one request to the capture address. Never throws. */
export async function answerCapture(
  request: CaptureAddressRequest,
  deps: CaptureAddressDeps,
): Promise<CaptureAddressReply> {
  // A missing or malformed token is refused before the body is read; the
  // check answers both without the database.
  if (!request.token || !isCaptureTokenShape(request.token)) {
    const verdict = await deps.check(request.token).catch(() => null);
    if (verdict && !verdict.ok) return refuse(verdict.status, verdict.reason, verdict.message);
    return refuse(401, 'missing', 'No capture token was sent.');
  }

  const declared = Number(request.contentLength ?? '');
  const bytes = new TextEncoder().encode(request.body).byteLength;
  if ((Number.isFinite(declared) && declared > CAPTURE_REQUEST_MAX_BYTES) || bytes > CAPTURE_REQUEST_MAX_BYTES) {
    return refuse(413, 'too_long', `That is too long to add. Keep it under ${CAPTURE_BODY_MAX} characters.`);
  }

  let json: unknown;
  try {
    json = JSON.parse(request.body);
  } catch {
    return refuse(400, 'bad_request', 'Dash could not read that. Send JSON with the words in "text".');
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return refuse(400, 'bad_request', 'Dash could not read that. Send JSON with the words in "text".');
  }
  const text = (parsed.data.text ?? '').trim();
  const url = parsed.data.url ? parsed.data.url : null;
  const placeAsked = parsed.data.place ? parsed.data.place : null;
  if (url && !isHttpUrl(url)) return refuse(400, 'bad_request', 'That link is not a web address.');
  if (!text && !url) return refuse(400, 'bad_request', 'There was nothing to add. Say or type something first.');
  if (placeAsked && !(CAPTURE_PLACES as readonly string[]).includes(placeAsked)) {
    return refuse(400, 'bad_request', `Dash does not know the place "${placeAsked}". Use ${placeList(CAPTURE_PLACES)}.`);
  }
  const sentence = captureSentence(text, url);
  if (sentence.length > CAPTURE_BODY_MAX) {
    return refuse(413, 'too_long', `That is too long to add. Keep it under ${CAPTURE_BODY_MAX} characters.`);
  }

  let verdict: CaptureTokenCheck;
  try {
    verdict = await deps.check(request.token);
  } catch (error) {
    console.error('capture address: token check failed', error);
    return refuse(503, 'unavailable', UNAVAILABLE, { 'Retry-After': '60' });
  }
  if (!verdict.ok) {
    const headers: Record<string, string> =
      verdict.status === 429 && verdict.retryAfterSeconds ? { 'Retry-After': String(verdict.retryAfterSeconds) } : {};
    return refuse(verdict.status, verdict.reason, verdict.message, headers);
  }

  try {
    const account = await deps.account(verdict.userId);
    const place = placeAsked as CapturePlace | null;
    if (place && !account.places.includes(place)) {
      return refuse(
        422,
        'place_off',
        place === 'vault'
          ? 'Dash cannot write to your vault: it is switched off or read-only.'
          : `Dash cannot file into ${place}: that workspace is switched off.`,
      );
    }
    if (account.places.length === 0) {
      return refuse(422, 'place_off', 'Every place Dash files into is switched off for your account.');
    }

    let parts: CapturePart[];
    let unsure = false;
    if (place) {
      parts = [{ place, text: sentence, goal: null, role: null }];
    } else {
      const sort = await account.sort(sentence, account.places);
      if (sort && sort.sure && sort.parts.length > 0) {
        parts = sort.parts;
      } else if (account.places.includes('todo')) {
        // The box would ask here. A Shortcut cannot show the chips, so the
        // sentence is kept where nothing is lost and it comes up again.
        parts = [{ place: 'todo', text: sentence, goal: null, role: null }];
        unsure = true;
      } else {
        return refuse(
          422,
          'not_filed',
          `Dash could not tell where this goes. Send it again with a place: ${placeList(account.places)}.`,
        );
      }
    }

    // A job with no role named: ask which, among the jobs only, as the box does.
    if (parts.some((part) => part.place === 'jobs' && !part.role)) {
      const jobs = await account.sort(sentence, ['jobs']);
      const role = jobs?.parts.find((part) => part.role)?.role ?? null;
      parts = parts.map((part) => (part.place === 'jobs' && !part.role ? { ...part, role } : part));
    }

    const result = await fileCaptureParts(parts, account.writers);
    if (result.filed.length === 0) {
      return refuse(422, 'not_filed', result.errors[0] ?? 'Nothing was filed.');
    }
    return {
      status: 200,
      headers: {},
      body: {
        ok: true,
        spoken: spokenFiled(result.filed, result.errors, unsure),
        filed: result.filed.map(({ place: p, where, href, actionId }) => ({ place: p, where, href, actionId })),
        errors: result.errors,
        unsure,
      },
    };
  } catch (error) {
    console.error('capture address: filing failed', error);
    return refuse(500, 'unavailable', UNAVAILABLE);
  }
}
