/**
 * Where a job for you is done, read out of its own instructions.
 *
 * Note 331c5a56 asked for the to-dos under Your actions to carry a link to the
 * place they are done, in the app or outside it. The instructions already say
 * where: "On the Thermodynamics subject page (/learn/s/…)", "in the Mailgun
 * dashboard", "in the Vercel project settings". This reads that back rather
 * than asking every session to file a URL as well, so it covers the rows
 * already waiting as well as the ones written from here on.
 *
 * First match wins, in this order: a full URL, because whoever wrote it meant
 * that exact place; then a path inside the app; then a service named in the
 * text. Null when the text names none of them, and the card draws no link
 * rather than a guess.
 */
export type WhereToDoIt = { href: string; label: string; external: boolean };

/** The app's own top-level routes, so `supabase/migrations-news` is not read as one. */
const APP_ROOTS = ['account', 'dev', 'home', 'jobs', 'learn', 'news', 'shopping', 'todo', 'vault'];

const URL = /https?:\/\/[^\s)<>"'`]+/;

// A path starts a word: not after a letter, a dot or another slash, so
// `app/dev/plan` and `docs/x.md` stay file names.
const APP_PATH = new RegExp(`(?<![\\w./-])/(?:${APP_ROOTS.join('|')})\\b(?:/[\\w\\-.~%?=&]*)*`);

/**
 * The services a setup job is done in, with the page it starts from. Only the
 * ones the plan's setup steps actually name; one more is a line here.
 */
const SERVICES: readonly { name: RegExp; label: string; href: string }[] = [
  { name: /\bvercel\b/i, label: 'Vercel', href: 'https://vercel.com/dashboard' },
  { name: /\bmailgun\b/i, label: 'Mailgun', href: 'https://app.mailgun.com' },
  {
    name: /\bsupabase\b/i,
    label: 'Supabase',
    href: 'https://supabase.com/dashboard/project/asjztutnqxbecruvyrbj',
  },
  { name: /\bgithub\b/i, label: 'GitHub', href: 'https://github.com/settings/tokens' },
  { name: /\bgoogle cloud\b/i, label: 'Google Cloud', href: 'https://console.cloud.google.com' },
  { name: /\bvoyage\b/i, label: 'Voyage', href: 'https://dashboard.voyageai.com' },
  { name: /\banthropic\b/i, label: 'Anthropic', href: 'https://console.anthropic.com' },
];

/** Punctuation a sentence puts after a link that is not part of it. */
function trimTail(link: string): string {
  return link.replace(/[.,;:!?)\]]+$/, '');
}

export function whereToDoIt(text: string | null): WhereToDoIt | null {
  if (!text) return null;

  const url = text.match(URL);
  if (url) {
    const href = trimTail(url[0]);
    let host = href;
    try {
      host = new globalThis.URL(href).hostname.replace(/^www\./, '');
    } catch {
      // Keep the whole string as its own label.
    }
    return { href, label: host, external: true };
  }

  const path = text.match(APP_PATH);
  if (path) {
    const href = trimTail(path[0]);
    return { href, label: 'Open the page', external: false };
  }

  // The service named first in the text, not first in the list: "in the
  // Mailgun dashboard … set it in Vercel" is done in Mailgun first.
  let first: { at: number; service: (typeof SERVICES)[number] } | null = null;
  for (const service of SERVICES) {
    const at = text.search(service.name);
    if (at >= 0 && (first === null || at < first.at)) first = { at, service };
  }
  if (first) {
    return { href: first.service.href, label: first.service.label, external: true };
  }

  return null;
}
