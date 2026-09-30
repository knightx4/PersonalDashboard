import type { DayBriefPick } from './picks';

/**
 * The morning notification, written from the picks (plan #1240).
 *
 * The title names the first pick and the body gives its reason and the other
 * picks, each short enough for a lock screen: about 50 characters of title
 * and 180 of body are what an iPhone shows before cutting off. Dash writes it
 * (lib/day-brief/model.ts, writeBrief); checkNotification reads what comes
 * back, and plainNotification builds one from the picks alone when Dash's is
 * unusable or there was no Dash to ask.
 *
 * A day with no picks is stored with NO_PICKS and sends nothing.
 */

export const TITLE_MAX = 50;
export const BODY_MAX = 180;

export type BriefNotification = { title: string; body: string };

/** What a day with nothing that qualifies is stored as. Never sent. */
export const NO_PICKS: BriefNotification = {
  title: 'Nothing stands out today',
  body: 'Nothing booked, due or waiting on you stands out. Everything else is on the Agenda.',
};

function tidy(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The text cut at a word to fit `max`, with an ellipsis when it was cut. */
export function clip(text: string, max: number): string {
  const clean = tidy(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  const head = space > max / 2 ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s,.;:]+$/, '')}…`;
}

/** The figures in a text: times, amounts, counts, dates. */
function figures(text: string): string[] {
  return text.match(/\d+(?:[.,:]\d+)*/g) ?? [];
}

/**
 * Dash's notification as it may be sent, or null when it is unusable: empty,
 * longer than a lock screen shows, or carrying a figure (a time, an amount, a
 * count) that none of the picks carries, which means it named something else
 * or invented a detail.
 */
export function checkNotification(
  reply: { title: string; body: string },
  picks: readonly DayBriefPick[],
): BriefNotification | null {
  const title = tidy(reply.title).replace(/[.!]+$/, '');
  const body = tidy(reply.body).replace(/!/g, '.');
  if (!title || !body || title.length > TITLE_MAX || body.length > BODY_MAX) return null;

  const known = new Set(picks.flatMap((pick) => figures(`${pick.title} ${pick.reason}`)));
  if (figures(`${title} ${body}`).some((figure) => !known.has(figure))) return null;
  return { title, body };
}

function sentence(text: string): string {
  const clean = tidy(text);
  return /[.?…]$/.test(clean) ? clean : `${clean}.`;
}

/**
 * The notification from the picks alone: the first pick's title as the
 * title, and its reason followed by each other pick and its reason as the
 * body. A pick whose reason does not fit is named without it, and one that
 * does not fit at all is left to the home page.
 */
export function plainNotification(picks: readonly DayBriefPick[]): BriefNotification {
  const [first, ...rest] = picks;
  if (!first) return NO_PICKS;

  let body = sentence(first.reason);
  for (const pick of rest) {
    const full = ` ${sentence(`${tidy(pick.title)}: ${tidy(pick.reason)}`)}`;
    const named = ` ${sentence(tidy(pick.title))}`;
    if (body.length + full.length <= BODY_MAX) body += full;
    else if (body.length + named.length <= BODY_MAX) body += named;
  }
  return { title: clip(first.title, TITLE_MAX), body: clip(body, BODY_MAX) };
}

/** The lines Dash writes the notification from, most important first. */
export function picksPrompt(day: string, picks: readonly DayBriefPick[]): string {
  return [
    `Today is ${day}.`,
    '',
    "Today's picks, most important first:",
    ...picks.map((pick, i) => `${i + 1}. ${tidy(pick.title)}. Why: ${tidy(pick.reason)}`),
  ].join('\n');
}
