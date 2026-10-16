import 'server-only';

import type { LicenceMode, StructureDocumentInput, StructureUnit } from '@/lib/learn/catalogue/structure';
import { fetchDocument } from './fetch';

/**
 * Official explainers and primary-source indexes, pulled from an allowlist
 * (plan #2247.6).
 *
 * Two kinds of page become structure documents here: an institution's own
 * explainer, whose chapters are both the order of a subject and the text to
 * learn it from (The Fed Explained), and the menu of a primary-source
 * collection, whose entries are the documents a historical question reads
 * (the Avalon Project's century menus).
 *
 * The hosts are a short list in code, `EXPLAINER_HOSTS`. A page on any other
 * host is refused before anything is fetched. Nothing here crawls: a host
 * gives one entry address, and the parser for that host says which further
 * pages that address names. To grow the list, add an entry to
 * `EXPLAINER_HOSTS`, a parser beside the two below, and a fixture saved from a
 * live fetch in fixtures/structure/explainers/. No other file changes.
 *
 * Each host carries the licence mode its documents are stored under:
 * federalreserve.gov publishes US government works, so `show`; the Avalon
 * Project states no terms for its menus, so `structure_only`, which keeps the
 * order and the titles and shows or feeds nothing.
 *
 * The parsers are pure functions of the page text, tested against excerpts of
 * the real pages. The fetch path is the shared one in ./fetch, which refuses
 * private addresses on every hop.
 */

export type ExplainerHost = {
  /** The catalogue provider the documents are stored under (seeded by migration 0160). */
  providerSlug: string;
  host: string;
  licenceMode: LicenceMode;
  /** Whether a page address is one this host's parser pulls from. */
  accepts: (url: URL) => boolean;
  pull: (url: URL) => Promise<ExplainerResult>;
};

export type ExplainerFailure = {
  ok: false;
  reason: 'not-allowlisted' | 'fetch-failed' | 'unparseable';
  detail: string;
};
export type ExplainerResult = { ok: true; document: StructureDocumentInput } | ExplainerFailure;

function failure(reason: ExplainerFailure['reason'], detail: string): ExplainerFailure {
  return { ok: false, reason, detail };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/** A fragment's visible text on one line: tags removed, entities decoded, spaces collapsed. */
function plain(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** The page's `<title>`, plain. */
function pageTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? plain(match[1]) : '';
}

// ---------------------------------------------------------------------------
// The Fed Explained, federalreserve.gov

const FED_HOST = 'www.federalreserve.gov';
export const FED_EXPLAINED_URL = `https://${FED_HOST}/aboutthefed/the-fed-explained.htm`;
const FED_FIRST_CHAPTER = `https://${FED_HOST}/aboutthefed/fedexplained/who-we-are.htm`;
const FED_CHAPTER_PATH = /^\/aboutthefed\/fedexplained\/[a-z0-9-]+\.htm$/;
/** The Fed Explained has six chapters. Runaway guard for a nav that changes shape. */
const MAX_FED_CHAPTERS = 12;

export type FedChapterLink = { heading: string; title: string; url: string };

/**
 * The chapters named in a chapter page's side navigation, in order. The
 * landing page's tiles are images with no text, so the index is read from the
 * nav every chapter page carries. A link to anywhere but a chapter path on
 * federalreserve.gov is ignored.
 */
export function parseFedChapterNav(html: string, pageUrl: string): FedChapterLink[] {
  const nav = /<nav[^>]*>([\s\S]*?)<\/nav>/i.exec(html)?.[1] ?? '';
  const links: FedChapterLink[] = [];
  const seen = new Set<string>();
  for (const match of nav.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try {
      url = new URL(decodeEntities(match[1]), pageUrl);
    } catch {
      continue;
    }
    if (url.hostname !== FED_HOST || !FED_CHAPTER_PATH.test(url.pathname)) continue;
    const href = `https://${FED_HOST}${url.pathname}`;
    if (seen.has(href)) continue;
    seen.add(href);
    const heading = plain(match[2]);
    const title = /title="([^"]*)"/i.exec(match[0])?.[1];
    links.push({ heading, title: title ? decodeEntities(title) : heading, url: href });
  }
  return links;
}

export type FedChapter = {
  /** The `<h2>` headings in the chapter's body, in order. */
  headings: string[];
  /** The chapter's readable text, one paragraph or list item per line. */
  text: string;
};

/**
 * One chapter's body. The page repeats its content for narrow screens, so
 * only the desktop section is read, and its video players and scripts are
 * dropped before the text is taken. Headings come out as their own lines,
 * list items as "- item".
 */
export function parseFedChapter(html: string): FedChapter {
  const section =
    /<section[^>]*class="[^"]*content-normal[^"]*"[^>]*>([\s\S]*?)<\/section>/i.exec(html)?.[1] ?? '';
  const body = section
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<video-js[\s\S]*?<\/video-js>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const headings: string[] = [];
  const lines: string[] = [];
  for (const match of body.matchAll(/<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = plain(match[2]);
    if (!text) continue;
    const tag = match[1].toLowerCase();
    if (tag.startsWith('h')) {
      headings.push(text);
      lines.push(text);
    } else if (tag === 'li') {
      lines.push(`- ${text}`);
    } else {
      lines.push(text);
    }
  }
  return { headings, text: lines.join('\n') };
}

async function pullFedExplained(entry: URL): Promise<ExplainerResult> {
  // Any chapter page carries the nav and the landing page does not, so the
  // first chapter is the way in, and its text is kept rather than fetched twice.
  const first = await fetchDocument(FED_FIRST_CHAPTER);
  if (!first.ok) return failure('fetch-failed', `${first.reason}: ${first.detail}`);
  const links = parseFedChapterNav(first.text, FED_FIRST_CHAPTER).slice(0, MAX_FED_CHAPTERS);
  if (links.length === 0) return failure('unparseable', 'No chapter links in the Fed Explained nav.');

  const units: StructureUnit[] = [];
  const raw: string[] = [];
  for (const link of links) {
    let html = first.text;
    if (link.url !== FED_FIRST_CHAPTER) {
      const page = await fetchDocument(link.url);
      if (!page.ok) return failure('fetch-failed', `${link.url}: ${page.reason}: ${page.detail}`);
      html = page.text;
    }
    const chapter = parseFedChapter(html);
    if (!chapter.text) return failure('unparseable', `No text in ${link.url}.`);
    units.push({
      label: null,
      heading: link.heading,
      topics: chapter.headings,
      readings: [{ title: link.title, url: link.url }],
    });
    raw.push(`# ${link.heading}\n${link.url}\n\n${chapter.text}`);
  }

  return {
    ok: true,
    document: {
      providerSlug: 'federal-reserve',
      externalId: 'the-fed-explained',
      title: 'The Fed Explained',
      canonicalUrl: entry.href,
      sourceUrl: FED_EXPLAINED_URL,
      author: 'Board of Governors of the Federal Reserve System',
      institution: 'Board of Governors of the Federal Reserve System',
      licenceMode: 'show',
      rawText: raw.join('\n\n'),
      units,
    },
  };
}

// ---------------------------------------------------------------------------
// The Avalon Project, avalon.law.yale.edu

const AVALON_HOST = 'avalon.law.yale.edu';
const AVALON_MENU_PATH = /^\/subject_menus\/[a-z0-9_-]+\.asp$/i;

export type AvalonEntry = { title: string; url: string; collection: boolean };
export type AvalonMenu = { title: string; entries: AvalonEntry[] };

/**
 * A century menu: its heading and each linked document, in the menu's own
 * (alphabetical) order. The menus are hand-written HTML: a few entries leave
 * out the closing `</a>`, and a document listed under two titles appears
 * twice, so an entry runs to whichever of `</a>` or `</li>` comes first and a
 * repeated address keeps its first title. An entry under /subject_menus/ is a
 * collection of documents, not a document.
 */
export function parseAvalonMenu(html: string, pageUrl: string): AvalonMenu {
  const heading = /<div class="document-title">([\s\S]*?)<\/div>/i.exec(html)?.[1];
  const title = heading ? plain(heading) : pageTitle(html);
  const entries: AvalonEntry[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<li>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)(?:<\/a>|<\/li>)/gi)) {
    let url: URL;
    try {
      url = new URL(decodeEntities(match[1]), pageUrl);
    } catch {
      continue;
    }
    if (url.hostname !== AVALON_HOST) continue;
    const text = plain(match[2]);
    if (!text || seen.has(url.pathname)) continue;
    seen.add(url.pathname);
    entries.push({
      title: text,
      url: `https://${AVALON_HOST}${url.pathname}`,
      collection: url.pathname.toLowerCase().startsWith('/subject_menus/'),
    });
  }
  return { title, entries };
}

/** Avalon's menu as the document the store keeps. */
export function avalonDocument(menu: AvalonMenu, menuUrl: URL): StructureDocumentInput {
  const slug = menuUrl.pathname.split('/').pop()!.replace(/\.asp$/i, '');
  return {
    providerSlug: 'avalon',
    externalId: `menu-${slug}`,
    title: `Avalon Project: ${menu.title}`,
    canonicalUrl: menuUrl.href,
    sourceUrl: menuUrl.href,
    author: null,
    institution: 'Lillian Goldman Law Library, Yale Law School',
    licenceMode: 'structure_only',
    rawText: [menu.title, ...menu.entries.map((entry) => `${entry.title}\n${entry.url}`)].join('\n'),
    units: menu.entries.map((entry) => ({
      label: null,
      heading: entry.title,
      topics: entry.collection ? ['A collection of documents'] : [],
      readings: [{ title: entry.title, url: entry.url }],
    })),
  };
}

async function pullAvalonMenu(menuUrl: URL): Promise<ExplainerResult> {
  const page = await fetchDocument(menuUrl.href);
  if (!page.ok) return failure('fetch-failed', `${page.reason}: ${page.detail}`);
  const menu = parseAvalonMenu(page.text, menuUrl.href);
  if (menu.entries.length === 0) return failure('unparseable', 'No document links in the Avalon menu.');
  return { ok: true, document: avalonDocument(menu, menuUrl) };
}

// ---------------------------------------------------------------------------
// The allowlist

export const EXPLAINER_HOSTS: ExplainerHost[] = [
  {
    providerSlug: 'federal-reserve',
    host: FED_HOST,
    licenceMode: 'show',
    accepts: (url) => url.pathname === '/aboutthefed/the-fed-explained.htm',
    pull: pullFedExplained,
  },
  {
    providerSlug: 'avalon',
    host: AVALON_HOST,
    licenceMode: 'structure_only',
    accepts: (url) => AVALON_MENU_PATH.test(url.pathname),
    pull: pullAvalonMenu,
  },
];

/** The allowlisted host an address belongs to, or null. https only. */
export function explainerHostFor(rawUrl: string): { host: ExplainerHost; url: URL } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = EXPLAINER_HOSTS.find((candidate) => candidate.host === url.hostname && candidate.accepts(url));
  return host ? { host, url } : null;
}

/**
 * Pull the structure document at an allowlisted address. The result is ready
 * for `storeStructure`; nothing is written here.
 */
export async function pullExplainer(rawUrl: string): Promise<ExplainerResult> {
  const match = explainerHostFor(rawUrl);
  if (!match) return failure('not-allowlisted', `${rawUrl} is not a page on the explainer allowlist.`);
  return match.host.pull(match.url);
}
