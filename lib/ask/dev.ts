import { SPECS, readSpec as readSpecFile, specBySlug, type SpecDoc } from '@/lib/specs/registry';
import { splitSections, type SpecSection } from '@/lib/specs/sections';
import { AskInputError, clip, optionalString, type AskContext, type AskRow, type AskToolResult } from './db';

/**
 * Dash reading the Dev workspace (feature #1319): the specs in full, by
 * section, and (from #1329 on) the Dev rows with their comments.
 *
 * Dev is the owner's alone, so every lookup here starts with `devAccess`.
 * The generic switched-off check in tools.ts cannot do this: it maps a schema
 * to a workspace, and the Dev tables sit in `public` with the shopping ones,
 * while a spec is a file and has no schema at all.
 */

/** The table a spec section is cited under; its ref is `<slug>#<anchor>`. */
export const SPEC_TABLE = 'docs.specs';

/** The most sections one read returns, so a broad query cannot carry a whole spec. */
export const MAX_SPEC_SECTIONS = 3;

/** The most characters of one section a read returns. */
export const SECTION_CHARS = 6000;

/**
 * Whether this asker may read Dev: the workspace is on for them, and the
 * database says they are the owner (`public.is_owner()`, migration 0085).
 * Fails closed: a read that errors is "no".
 */
export async function devAccess(ctx: AskContext): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!ctx.enabledModules.includes('dev')) {
    return { ok: false, error: 'The Dev workspace is switched off, so it cannot be read.' };
  }
  try {
    const client = await ctx.db('public');
    const { data, error } = await client.rpc('is_owner');
    if (!error && data === true) return { ok: true };
  } catch {
    // Fall through: an owner check that could not run is not a yes.
  }
  return { ok: false, error: 'Dev belongs to the owner of this app, and this account is not the owner.' };
}

/** The words of a query worth matching: lowercased, two letters or more. */
export function queryWords(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  return [...new Set(words.filter((word) => !STOP_WORDS.has(word)))];
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'about', 'what', 'does', 'say', 'says', 'how', 'with', 'from', 'that',
  'this', 'are', 'is', 'of', 'to', 'in', 'on', 'it', 'an', 'or', 'do', 'we', 'our', 'spec',
]);

function escape(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * How well a section answers the query: how many of its words start a word
 * somewhere in the heading or body ("dash" finds "dashes", "em" does not find
 * "them"), and how often, with a heading match worth five.
 */
export function sectionScore(
  section: SpecSection,
  words: readonly string[],
): { words: number; hits: number } {
  let matched = 0;
  let hits = 0;
  for (const word of words) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}`, 'giu');
    const inHeading = section.heading.match(pattern)?.length ?? 0;
    const inBody = section.body.match(pattern)?.length ?? 0;
    if (inHeading + inBody > 0) matched += 1;
    hits += inHeading * 5 + inBody;
  }
  return { words: matched, hits };
}

/**
 * A section's text for the model, at most SECTION_CHARS. A longer one is cut
 * from the paragraph holding the first match, so the part that answers the
 * question is the part that survives.
 */
export function sectionText(body: string, words: readonly string[]): { text: string; clipped: boolean } {
  if (body.length <= SECTION_CHARS) return { text: body, clipped: false };
  let start = 0;
  for (const word of words) {
    const at = body.toLowerCase().search(new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}`, 'u'));
    if (at > 0 && (start === 0 || at < start)) start = at;
  }
  if (start > 0) start = Math.max(0, body.lastIndexOf('\n\n', start));
  const window = body.slice(start, start + SECTION_CHARS).trim();
  return { text: `${start > 0 ? '… ' : ''}${window} …`, clipped: true };
}

function sectionRow(spec: SpecDoc, section: SpecSection, detail: AskRow['detail']): AskRow {
  return {
    table: SPEC_TABLE,
    ref: `${spec.slug}#${section.anchor}`,
    title: `${spec.title}: ${section.heading}`,
    href: `/dev/specs/${spec.slug}#${section.anchor}`,
    detail,
  };
}

type Input = Record<string, unknown>;

/**
 * read_spec: one spec, cut at its `##` headings the way its page cuts it
 * (lib/specs/sections.ts), so every section links to the card showing it.
 *
 * With `section`, that section. With `query`, the sections holding every word
 * of it, best first. With neither, or a query nothing matches, the headings,
 * so the model can pick one and ask again.
 */
export async function readSpecLookup(ctx: AskContext, input: Input): Promise<AskToolResult> {
  const access = await devAccess(ctx);
  if (!access.ok) return access;

  const slug = optionalString(input, 'spec');
  if (!slug) throw new AskInputError('Name the spec by its slug.');
  const spec = specBySlug(slug.replace(/#.*$/, ''));
  if (!spec) {
    throw new AskInputError(`There is no spec called ${slug}. The specs: ${SPECS.map((s) => s.slug).join(', ')}.`);
  }
  // A section ref from an earlier read (`writing#reward`) names its anchor too.
  const anchor = optionalString(input, 'section') ?? (slug.includes('#') ? slug.split('#')[1] : null);
  const query = optionalString(input, 'query');

  const markdown = await (ctx.readSpec ?? readSpecFile)(spec);
  if (markdown === null) {
    return { ok: true, rows: [], note: `${spec.file} is missing from the repository, so ${spec.title} cannot be read.` };
  }
  const sections = splitSections(markdown);

  const headings = (note: string): AskToolResult => ({
    ok: true,
    rows: sections.map((section) =>
      sectionRow(spec, section, { heading: section.heading, section: section.anchor, characters: section.body.length }),
    ),
    note,
  });

  if (anchor) {
    const section = sections.find((s) => s.anchor === anchor.toLowerCase());
    if (!section) return headings(`${spec.title} has no section ${anchor}. Its headings are listed; read one by its section.`);
    const { text, clipped } = sectionText(section.body, query ? queryWords(query) : []);
    return {
      ok: true,
      rows: [sectionRow(spec, section, { heading: section.heading, text })],
      note: clipped ? `The section is longer than ${SECTION_CHARS} characters and was cut.` : undefined,
    };
  }

  // "What does the writing guide say about em dashes" names the spec as well
  // as the topic, and the spec's own name is in none of its sections.
  const named = new Set(queryWords(`${spec.title} ${spec.slug}`));
  const all = query ? queryWords(query) : [];
  const words = all.some((word) => !named.has(word)) ? all.filter((word) => !named.has(word)) : all;
  if (words.length === 0) {
    return headings(`${spec.title}'s headings. Read one by passing its section, or pass a query to find the sections about it.`);
  }

  // The sections matching the most of the query's words, most matches first.
  const scored = sections.map((section) => ({ section, ...sectionScore(section, words) }));
  const most = Math.max(0, ...scored.map((m) => m.words));
  const matches = scored
    .filter((m) => most > 0 && m.words === most)
    .sort((a, b) => b.hits - a.hits || a.section.position - b.section.position);
  if (matches.length === 0) {
    return headings(`No section of ${spec.title} mentions "${query}". Its headings are listed; read one by its section.`);
  }

  const shown = matches.slice(0, MAX_SPEC_SECTIONS);
  let clippedAny = false;
  const rows = shown.map(({ section }) => {
    const { text, clipped } = sectionText(section.body, words);
    clippedAny ||= clipped;
    return sectionRow(spec, section, { heading: section.heading, text });
  });
  const notes = [
    matches.length > shown.length
      ? `${matches.length} sections match; the best ${shown.length} are here. Others: ${matches
          .slice(shown.length)
          .map((m) => m.section.anchor)
          .join(', ')}.`
      : null,
    clippedAny ? `A section longer than ${SECTION_CHARS} characters was cut from the paragraph that matches.` : null,
  ].filter(Boolean);
  return { ok: true, rows, note: notes.length > 0 ? notes.join(' ') : undefined };
}

/** For the tool's description: the specs Dash can read, by slug. */
export function specList(): string {
  return SPECS.map((spec) => `${spec.slug} (${clip(spec.title, 60)})`).join('; ');
}
