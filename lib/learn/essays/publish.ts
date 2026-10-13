/**
 * The published snapshot of an essay (plan #1863.11; docs/LEARN-ESSAYS-SPEC.md,
 * "Finishing and publishing", rule R4).
 *
 * Publish copies the note as the vault holds it into `learn.essays`, and
 * selveyknight.com reads that copy through `public.published_essays()` and
 * `public.published_essay(slug)`. What goes in:
 *
 * - The authorship block is removed first, before anything else reads the file.
 * - The frontmatter is removed from the body; the site gets the fields it
 *   shows (title, description, stage, confidence, tags) as columns.
 * - The essay's own `# Title` line is removed, since the title is a field.
 * - Footnotes are kept as written, links to the web included.
 * - A `[[wikilink]]` to another published essay becomes a markdown link to
 *   `/writing/<its slug>`; any other wikilink becomes its text, the alias when
 *   it has one. An embed (`![[…]]`) is removed, since it would pull in a
 *   private note or file.
 * - A markdown link or image whose address is not on the web (a relative
 *   path, an `obsidian://` link) becomes its text, or goes for an image.
 * - Obsidian comments (`%% … %%`) are removed: they are the person's own.
 *
 * Unpublishing an essay takes the links to it out of the snapshots of the
 * essays still published (`unlinkEssay`), so no snapshot points at an essay
 * that is no longer on the site.
 *
 * Pure: no database, so all of it is tested.
 */

import { parseNote } from '@/lib/vault/markdown/note';
import { parseWikiLink } from '@/lib/vault/markdown/obsidian';
import { ESSAY_ADDRESS_PREFIX, essayAddress } from './address';
import { stripAuthorshipBlock } from './authorship';
import { essayTitle } from './model';
import { readEssayFrontmatter, type EssayConfidence, type EssayStage } from './note';

export { ESSAY_ADDRESS_PREFIX, essayAddress };

/** What one Publish press writes to the essay row. */
export type EssaySnapshot = {
  body: string;
  title: string;
  description: string;
  stage: EssayStage;
  confidence: EssayConfidence | null;
  tags: string[];
};

const WIKILINK = /(!)?\[\[([^\]\n]+)\]\]/g;
const MARKDOWN_LINK = /(!)?\[([^\]\n]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"\n]*")?\s*\)/g;
const COMMENT = /%%[\s\S]*?%%/g;
const WEB = /^(https?:\/\/|mailto:|#)/i;

/** A note's name as a wikilink names it: the file name without folder or `.md`, lower case. */
export function linkKey(pathOrName: string): string {
  const name = pathOrName.replace(/\.md$/i, '');
  return name.slice(name.lastIndexOf('/') + 1).trim().toLowerCase();
}

function wikilinkText(raw: string): string {
  const link = parseWikiLink(raw, false);
  const alias = raw.includes('|') ? raw.slice(raw.indexOf('|') + 1).trim() : '';
  return alias || link.target || link.anchor || '';
}

/**
 * The body with every link that could reach a private note made safe.
 * `published` maps `linkKey` of a published essay's note to its slug.
 */
export function publicLinks(body: string, published: ReadonlyMap<string, string>): string {
  const wiki = body.replace(WIKILINK, (_match, embed: string | undefined, raw: string) => {
    if (embed) return '';
    const text = wikilinkText(raw);
    const slug = published.get(linkKey(parseWikiLink(raw, false).target));
    return slug ? `[${text}](${essayAddress(slug)})` : text;
  });
  return wiki.replace(MARKDOWN_LINK, (match, image: string | undefined, text: string, url: string) => {
    if (WEB.test(url) || url.startsWith(ESSAY_ADDRESS_PREFIX)) return match;
    return image ? '' : text;
  });
}

/** The first line, when it is the essay's `# Title`. */
function withoutTitle(body: string): string {
  return body.replace(/^\s*#[ \t]+[^\n]*\n?/, '');
}

function tidy(body: string): string {
  const text = body
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text ? `${text}\n` : '';
}

/**
 * The snapshot of an essay note as the vault holds it (`file`, frontmatter,
 * body and authorship block). `path` is the note's path, for the title when
 * the frontmatter has none; `today` stands in for a missing date.
 */
export function essaySnapshot(
  file: string,
  opts: { path: string; today: string; published: ReadonlyMap<string, string> },
): EssaySnapshot {
  // R4: the authorship block goes before anything reads the note.
  const note = parseNote(stripAuthorshipBlock(file), opts.path);
  const fallback = essayTitle(note.body, opts.path);
  const fm = readEssayFrontmatter({ ...note.frontmatter, type: 'essay' }, { title: fallback, today: opts.today });
  const body = tidy(publicLinks(withoutTitle(note.body).replace(COMMENT, ''), opts.published));
  return {
    body,
    title: fm?.title || fallback,
    description: fm?.description ?? '',
    stage: fm?.stage ?? 'draft',
    confidence: fm?.confidence ?? null,
    tags: fm?.tags ?? [],
  };
}

/** A snapshot with its links to the essay at `slug` turned back into their text. */
export function unlinkEssay(body: string, slug: string): string {
  const address = essayAddress(slug);
  return body.replace(MARKDOWN_LINK, (match, image: string | undefined, text: string, url: string) =>
    !image && url === address ? text : match,
  );
}

/** Whether a snapshot links to the essay at `slug`. */
export function linksToEssay(body: string, slug: string): boolean {
  return unlinkEssay(body, slug) !== body;
}
