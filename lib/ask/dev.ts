import { SPECS, readSpec as readSpecFile, specBySlug, type SpecDoc } from '@/lib/specs/registry';
import { splitSections, type SpecSection } from '@/lib/specs/sections';
import { firstLine, planHref, raiseAnchor, waitingAnchor } from '@/lib/search/sources/dev-map';
import { escapeLike } from '@/lib/search/sources/map';
import {
  AskInputError,
  clip,
  optionalString,
  type AskContext,
  type AskRow,
  type AskToolResult,
  type SchemaClient,
} from './db';

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

// ---------------------------------------------------------------------------
// read_dev_row: one idea, note, plan step or raise, with its comments (#1329)
// ---------------------------------------------------------------------------

/** What read_dev_row takes as a kind, and the table each is cited under (search's HIT_TABLES). */
export const DEV_ROW_KINDS = ['idea', 'note', 'step', 'raise'] as const;
export type DevRowKind = (typeof DEV_ROW_KINDS)[number];

export const DEV_ROW_TABLES: Record<DevRowKind, string> = {
  idea: 'public.ideas',
  note: 'public.feedback_items',
  step: 'public.plan_items',
  raise: 'public.raised_items',
};

/** Other names a kind arrives under: the table search cited, or search's own kind. */
const KIND_ALIASES: Record<string, DevRowKind> = {
  ...Object.fromEntries(Object.entries(DEV_ROW_TABLES).map(([kind, table]) => [table, kind])),
  feedback: 'note',
  plan: 'step',
  question: 'step',
  decision: 'step',
};

/** The dev_comments column that ties a comment to each kind of row. */
const COMMENT_COLUMN: Record<DevRowKind, string> = {
  idea: 'idea_id',
  note: 'feedback_item_id',
  step: 'plan_item_id',
  raise: 'raised_item_id',
};

/** The most comments one read returns: the newest, still oldest first. */
export const MAX_DEV_COMMENTS = 40;

/** The most characters of one comment a read returns. */
export const DEV_COMMENT_CHARS = 2000;

/** Who wrote a comment or filed an idea, as the model is to name them. */
export function writer(author: string | null | undefined): string {
  if (author === 'claude') return 'Dash';
  if (author === 'me') return 'me';
  return author ?? 'unknown';
}

/** Long text for the model, newlines kept, cut at `max`. */
function longText(text: string | null | undefined, max = SECTION_CHARS): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max).trimEnd()} …`;
}

const UUID_IN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function devKind(input: Input): DevRowKind {
  const kind = optionalString(input, 'kind');
  const resolved = kind && ((DEV_ROW_KINDS as readonly string[]).includes(kind) ? (kind as DevRowKind) : KIND_ALIASES[kind]);
  if (!resolved) throw new AskInputError(`kind must be one of ${DEV_ROW_KINDS.join(', ')}.`);
  return resolved;
}

/** A step by its number ("#1248", "1248") or id; anything else by the id in the ref, a link included. */
function devRef(kind: DevRowKind, input: Input): { column: 'id' | 'number'; value: string | number } {
  const ref = optionalString(input, 'ref');
  if (!ref) throw new AskInputError('Give the ref: the row\'s id, or a step\'s number.');
  const number = ref.match(/^#?(\d+)$/)?.[1];
  if (kind === 'step' && number) return { column: 'number', value: Number(number) };
  const id = ref.match(UUID_IN)?.[0];
  if (!id) {
    throw new AskInputError(
      kind === 'step' ? `${ref} is neither a step number nor an id.` : `${ref} is not an id; search returns one for each row.`,
    );
  }
  return { column: 'id', value: id.toLowerCase() };
}

type DevComment = { author: string | null; body: string | null; created_at: string };

/** The thread under a row as one block of text, each comment headed by its day and writer. */
function thread(comments: DevComment[]): { text: string | null; count: number; dropped: number } {
  const dropped = Math.max(0, comments.length - MAX_DEV_COMMENTS);
  const text = comments
    .slice(dropped)
    .map((c) => `[${c.created_at.slice(0, 10)}, ${writer(c.author)}] ${longText(c.body, DEV_COMMENT_CHARS) ?? ''}`)
    .join('\n\n');
  return { text: text || null, count: comments.length, dropped };
}

/** An idea's or note's triage, which Dash wrote: "kind feature, module app, priority 3". */
function triageText(triage: unknown): string | null {
  if (!triage || typeof triage !== 'object') return null;
  const parts: string[] = [];
  for (const [key, field] of Object.entries(triage as Record<string, unknown>)) {
    if (!field || typeof field !== 'object' || !('value' in field)) continue;
    const value = (field as { value: unknown }).value;
    if (value !== null && value !== undefined) parts.push(`${key} ${String(value)}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

type Detail = NonNullable<AskRow['detail']>;
type Found = { id: string; title: string; href: string; detail: Detail };

async function readIdea(client: SchemaClient, ctx: AskContext, id: string): Promise<Found | null> {
  const { data, error } = await client
    .from('ideas')
    .select('id, body, module, source, triage, created_at, plan_item_id')
    .eq('user_id', ctx.userId)
    .eq('id', id)
    .is('dismissed_at', null)
    .limit(1);
  if (error) throw new Error(`ideas: ${error.message}`);
  const row = (data ?? [])[0] as
    | { id: string; body: string; module: string | null; source: string | null; triage: unknown; created_at: string; plan_item_id: string | null }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    title: firstLine(row.body),
    href: `/dev/ideas#idea-${row.id}`,
    detail: {
      filed_by: writer(row.source),
      filed_on: row.created_at.slice(0, 10),
      workspace: row.module,
      body: longText(row.body),
      triage_by_dash: triageText(row.triage),
      shaped_into_plan: row.plan_item_id !== null,
    },
  };
}

async function readNote(client: SchemaClient, ctx: AskContext, id: string): Promise<Found | null> {
  const { data, error } = await client
    .from('feedback_items')
    .select('id, body, kind, status, page_path, resolution_note, triage, created_at')
    .eq('user_id', ctx.userId)
    .eq('id', id)
    .limit(1);
  if (error) throw new Error(`feedback_items: ${error.message}`);
  const row = (data ?? [])[0] as
    | { id: string; body: string; kind: string; status: string; page_path: string | null; resolution_note: string | null; triage: unknown; created_at: string }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    title: firstLine(row.body),
    href: `/dev/bugs#note-${row.id}`,
    detail: {
      filed_by: 'me',
      filed_on: row.created_at.slice(0, 10),
      kind: row.kind,
      status: row.status,
      page: row.page_path,
      body: longText(row.body),
      triage_by_dash: triageText(row.triage),
      resolution_by_dash: longText(row.resolution_note),
    },
  };
}

type PlanRow = {
  id: string;
  number: number;
  title: string;
  kind: string;
  status: string;
  detail: string | null;
  acceptance: string | null;
  comment: string | null;
  resolution: string | null;
  fog: string | null;
  fog_dismissed_at: string | null;
  block_ask: string | null;
  parent_id: string | null;
};

async function readStep(
  client: SchemaClient,
  ctx: AskContext,
  ref: { column: 'id' | 'number'; value: string | number },
): Promise<Found | null> {
  const { data, error } = await client
    .from('plan_items')
    .select('id, number, title, kind, status, detail, acceptance, comment, resolution, fog, fog_dismissed_at, block_ask, parent_id')
    .eq('user_id', ctx.userId)
    .eq(ref.column, ref.value)
    .is('dismissed_at', null)
    .limit(1);
  if (error) throw new Error(`plan_items: ${error.message}`);
  const row = (data ?? [])[0] as PlanRow | undefined;
  if (!row) return null;

  // The questions put beneath it, which is where "what is decided so far" is
  // written: each answered one with its answer, each open one as waiting.
  const [below, above] = await Promise.all([
    client
      .from('plan_items')
      .select('number, title, status, resolution')
      .eq('user_id', ctx.userId)
      .eq('parent_id', row.id)
      .eq('kind', 'decision')
      .is('dismissed_at', null)
      .order('position', { ascending: true }),
    row.parent_id
      ? client.from('plan_items').select('number, title').eq('user_id', ctx.userId).eq('id', row.parent_id).limit(1)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (below.error) throw new Error(`plan_items: ${below.error.message}`);
  if (above.error) throw new Error(`plan_items: ${above.error.message}`);
  const decisions = ((below.data ?? []) as { number: number; title: string; status: string; resolution: string | null }[])
    .filter((d) => d.status !== 'dropped')
    .map((d) =>
      d.status === 'done' && d.resolution
        ? `#${d.number} ${d.title} Answered: ${longText(d.resolution, DEV_COMMENT_CHARS)}`
        : `#${d.number} ${d.title} Not answered yet.`,
    );
  const parent = ((above.data ?? []) as { number: number; title: string }[])[0];

  // An open question is answered on the Dash tab, so it links there, as search does.
  const waiting = row.kind === 'decision' && row.status !== 'done' && row.status !== 'dropped';
  return {
    id: row.id,
    title: `#${row.number} ${row.title}`,
    href: waiting ? `/dev/raised#${waitingAnchor(row.id)}` : planHref(row.number),
    detail: {
      number: row.number,
      kind: row.kind,
      status: row.status,
      under: parent ? `#${parent.number} ${parent.title}` : null,
      detail: longText(row.detail),
      done_when: longText(row.acceptance),
      resolution: longText(row.resolution),
      fog: row.fog_dismissed_at ? null : longText(row.fog),
      blocked_on: row.block_ask,
      // Mostly dated lines sessions wrote as they started, blocked and closed it.
      history: longText(row.comment),
      decisions: decisions.length > 0 ? decisions.join('\n') : null,
    },
  };
}

async function readRaise(client: SchemaClient, ctx: AskContext, id: string): Promise<Found | null> {
  // Not dismissed, and not a goal's flag, which lives on the Goals pages: the
  // raises the Dash tab draws and search finds.
  const { data, error } = await client
    .from('raised_items')
    .select('id, title, detail, ask, status, source, outcome, module, created_at')
    .eq('user_id', ctx.userId)
    .eq('id', id)
    .neq('status', 'dismissed')
    .is('goal_id', null)
    .limit(1);
  if (error) throw new Error(`raised_items: ${error.message}`);
  const row = (data ?? [])[0] as
    | { id: string; title: string; detail: string | null; ask: string | null; status: string; source: string | null; outcome: string | null; module: string | null; created_at: string }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    href: `/dev/raised#${raiseAnchor(row.id)}`,
    detail: {
      raised_by: 'Dash',
      raised_on: row.created_at.slice(0, 10),
      from_run: row.source,
      workspace: row.module,
      status: row.status,
      detail: longText(row.detail),
      ask: row.ask,
      outcome: longText(row.outcome),
    },
  };
}

/**
 * read_dev_row: one idea, note, plan step or raise, in full, with the thread
 * of comments under it oldest first, each comment labelled with who wrote it.
 *
 * A dismissed idea, step or raise reads as not there, the way search leaves it
 * out: putting a row aside is saying you do not want it put in front of you.
 * Notes have no dismissal. What Dash wrote is named as Dash's: a
 * session-filed idea, a raise, triage, a note's resolution and the comments
 * whose author is `claude`.
 */
export async function readDevRowLookup(ctx: AskContext, input: Input): Promise<AskToolResult> {
  const access = await devAccess(ctx);
  if (!access.ok) return access;

  const kind = devKind(input);
  const ref = devRef(kind, input);
  const client = await ctx.db('public');

  const found =
    kind === 'step'
      ? await readStep(client, ctx, ref)
      : kind === 'idea'
        ? await readIdea(client, ctx, String(ref.value))
        : kind === 'note'
          ? await readNote(client, ctx, String(ref.value))
          : await readRaise(client, ctx, String(ref.value));
  if (!found) {
    return { ok: true, rows: [], note: `There is no ${kind} ${ref.value} to read: none of theirs has it, or it was dismissed.` };
  }

  const { data, error } = await client
    .from('dev_comments')
    .select('author, body, created_at')
    .eq('user_id', ctx.userId)
    .eq(COMMENT_COLUMN[kind], found.id)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`dev_comments: ${error.message}`);
  const comments = thread((data ?? []) as DevComment[]);

  return {
    ok: true,
    rows: [
      {
        table: DEV_ROW_TABLES[kind],
        ref: found.id,
        title: clip(found.title, 200) ?? found.id,
        href: found.href,
        detail: { ...found.detail, comment_count: comments.count, comments: comments.text },
      },
    ],
    note:
      comments.dropped > 0
        ? `The thread has ${comments.count} comments; the oldest ${comments.dropped} are left out.`
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// find_dev_text: the words inside Dev rows and specs (#1323)
// ---------------------------------------------------------------------------

/** What find_dev_text can be narrowed to. A comment is found under the row it sits on. */
export const DEV_TEXT_KINDS = ['idea', 'note', 'step', 'raise', 'comment', 'spec'] as const;
export type DevTextKind = (typeof DEV_TEXT_KINDS)[number];

/** The most rows one search returns, newest first. Spec sections come on top of these. */
export const MAX_DEV_TEXT_HITS = 20;

/** The most spec sections one search returns, best first. */
export const MAX_SPEC_TEXT_HITS = 5;

/** How many rows each column's read takes before the words are checked. */
const DEV_TEXT_READ = 40;

/** The length of the excerpt around the match. */
export const EXCERPT_CHARS = 280;

/** A word matched at the start of a word, as sectionScore matches it. */
function wordPattern(word: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}`, 'iu');
}

/** Whether every word of the query starts a word somewhere in the text. */
export function hasEveryWord(text: string | null | undefined, words: readonly string[]): boolean {
  return !!text && words.every((word) => wordPattern(word).test(text));
}

/**
 * The part of a text around its first match, on one line, at most
 * EXCERPT_CHARS with an ellipsis at each end that was cut.
 */
export function excerpt(text: string, words: readonly string[], chars = EXCERPT_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= chars) return flat;
  let at = -1;
  for (const word of words) {
    const found = flat.search(wordPattern(word));
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  let start = Math.max(0, at - Math.floor(chars / 3));
  if (start > 0) {
    const space = flat.indexOf(' ', start);
    if (space >= 0 && space < at) start = space + 1;
  }
  const end = Math.min(flat.length, start + chars);
  return `${start > 0 ? '… ' : ''}${flat.slice(start, end).trim()}${end < flat.length ? ' …' : ''}`;
}

type TextHit = { key: string; at: string; row: AskRow };

/** One column's matches: the rows whose text holds every word, as hits. */
type ColumnRead = {
  kind: Exclude<DevTextKind, 'comment' | 'spec'>;
  table: string;
  column: string;
  select: string;
  date: string;
  /** What the field is called for the model. */
  field: string;
  narrow: (query: Filter) => Filter;
  hit: (row: Row) => { title: string; href: string; writtenBy: string | null };
};

type Row = Record<string, unknown> & { id: string };

/** A read in progress, after select and before its filters. */
type Filter = ReturnType<ReturnType<SchemaClient['from']>['select']>;

/** A read of the asker's rows of one table, the columns named at run time. */
function start(client: SchemaClient, ctx: AskContext, table: string, select: string): Filter {
  return (client.from(table).select(select) as unknown as Filter).eq('user_id', ctx.userId);
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function stepHit(row: Row): { title: string; href: string } {
  const waiting = row.kind === 'decision' && row.status !== 'done' && row.status !== 'dropped';
  return {
    title: `#${String(row.number)} ${str(row.title)}`,
    href: waiting ? `/dev/raised#${waitingAnchor(row.id)}` : planHref(Number(row.number)),
  };
}

const notDismissed = (q: Filter) => q.is('dismissed_at', null);
const openRaise = (q: Filter) => q.neq('status', 'dismissed').is('goal_id', null);
const asIs = (q: Filter) => q;
const STEP_SELECT = 'id, number, title, kind, status, updated_at';

/**
 * Every text column worth searching, and who wrote it. A plan step's detail
 * and done-when are shaped by sessions and approved by the person, so they
 * are named as neither; its history is the dated lines sessions write, and
 * its resolution is the person's answer.
 */
const COLUMN_READS: ColumnRead[] = [
  {
    kind: 'idea', table: 'ideas', column: 'body', select: 'id, body, source, updated_at', date: 'updated_at', field: 'idea',
    narrow: notDismissed,
    hit: (row) => ({ title: firstLine(str(row.body)), href: `/dev/ideas#idea-${row.id}`, writtenBy: writer(row.source as string | null) }),
  },
  {
    kind: 'note', table: 'feedback_items', column: 'body', select: 'id, body, updated_at', date: 'updated_at', field: 'note',
    narrow: asIs,
    hit: (row) => ({ title: firstLine(str(row.body)), href: `/dev/bugs#note-${row.id}`, writtenBy: 'me' }),
  },
  {
    kind: 'note', table: 'feedback_items', column: 'resolution_note', select: 'id, body, resolution_note, updated_at', date: 'updated_at', field: 'resolution',
    narrow: asIs,
    hit: (row) => ({ title: firstLine(str(row.body)), href: `/dev/bugs#note-${row.id}`, writtenBy: 'Dash' }),
  },
  ...(
    [
      ['detail', 'detail', null],
      ['acceptance', 'done-when', null],
      ['resolution', 'answer', 'me'],
      ['comment', 'history', 'Dash'],
    ] as const
  ).map(
    ([column, field, writtenBy]): ColumnRead => ({
      kind: 'step', table: 'plan_items', column, select: `${STEP_SELECT}, ${column}`, date: 'updated_at', field,
      narrow: notDismissed,
      hit: (row) => ({ ...stepHit(row), writtenBy }),
    }),
  ),
  ...(
    [
      ['detail', 'detail'],
      ['ask', 'ask'],
    ] as const
  ).map(
    ([column, field]): ColumnRead => ({
      kind: 'raise', table: 'raised_items', column, select: `id, title, ${column}, created_at`, date: 'created_at', field,
      narrow: openRaise,
      hit: (row) => ({ title: str(row.title), href: `/dev/raised#${raiseAnchor(row.id)}`, writtenBy: 'Dash' }),
    }),
  ),
];

async function readColumn(
  client: SchemaClient,
  ctx: AskContext,
  read: ColumnRead,
  pattern: string,
  words: readonly string[],
): Promise<TextHit[]> {
  const { data, error } = await read
    .narrow(start(client, ctx, read.table, read.select))
    .ilike(read.column, pattern)
    .order(read.date, { ascending: false })
    .limit(DEV_TEXT_READ);
  if (error) throw new Error(`${read.table}: ${error.message}`);
  return ((data ?? []) as unknown as Row[])
    .filter((row) => hasEveryWord(str(row[read.column]), words))
    .map((row) => {
      const { title, href, writtenBy } = read.hit(row);
      const table = `public.${read.table}`;
      return {
        key: `${table}:${row.id}`,
        at: str(row[read.date]),
        row: {
          table,
          ref: row.id,
          title: clip(title, 200) ?? row.id,
          href,
          detail: {
            kind: read.kind,
            field: read.field,
            written_by: writtenBy,
            on: str(row[read.date]).slice(0, 10),
            excerpt: excerpt(str(row[read.column]), words),
          },
        },
      };
    });
}

/** The read that finds a kind's rows, reused to fetch the row a comment sits on. */
const readOf = (kind: ColumnRead['kind']): ColumnRead => COLUMN_READS.find((read) => read.kind === kind)!;

const COMMENT_TARGETS = (Object.entries(COMMENT_COLUMN) as [DevRowKind, string][]).map(([kind, column]) => ({
  column,
  read: readOf(kind),
}));

/**
 * The comments holding every word, each cited as the row it sits on, so
 * read_dev_row reads the thread. A comment under a dismissed row, or under a
 * row that is not the asker's, is left out with its row.
 */
async function readComments(
  client: SchemaClient,
  ctx: AskContext,
  pattern: string,
  words: readonly string[],
): Promise<TextHit[]> {
  const { data, error } = await client
    .from('dev_comments')
    .select('id, author, body, created_at, idea_id, feedback_item_id, plan_item_id, raised_item_id, spec_section_id')
    .eq('user_id', ctx.userId)
    .ilike('body', pattern)
    .order('created_at', { ascending: false })
    .limit(DEV_TEXT_READ);
  if (error) throw new Error(`dev_comments: ${error.message}`);
  const comments = ((data ?? []) as unknown as Row[]).filter((c) => hasEveryWord(str(c.body), words));
  if (comments.length === 0) return [];

  const idsOf = (column: string) => [...new Set(comments.map((c) => c[column]).filter((v): v is string => typeof v === 'string'))];
  const parents = new Map<string, { table: string; ref: string; title: string; href: string }>();

  await Promise.all([
    ...COMMENT_TARGETS.map(async ({ column, read }) => {
      const ids = idsOf(column);
      if (ids.length === 0) return;
      const { data: rows, error: parentError } = await read
        .narrow(start(client, ctx, read.table, read.select))
        .in('id', ids);
      if (parentError) throw new Error(`${read.table}: ${parentError.message}`);
      for (const row of (rows ?? []) as unknown as Row[]) {
        const { title, href } = read.hit(row);
        parents.set(row.id, { table: `public.${read.table}`, ref: row.id, title, href });
      }
    }),
    (async () => {
      const ids = idsOf('spec_section_id');
      if (ids.length === 0) return;
      const { data: rows, error: sectionError } = await client
        .from('spec_sections')
        .select('id, slug, anchor, heading')
        .eq('user_id', ctx.userId)
        .in('id', ids);
      if (sectionError) throw new Error(`spec_sections: ${sectionError.message}`);
      for (const row of (rows ?? []) as unknown as Row[]) {
        const spec = specBySlug(str(row.slug));
        parents.set(row.id, {
          table: SPEC_TABLE,
          ref: `${str(row.slug)}#${str(row.anchor)}`,
          title: `${spec?.title ?? str(row.slug)}: ${str(row.heading)}`,
          href: `/dev/specs/${str(row.slug)}#${str(row.anchor)}`,
        });
      }
    })(),
  ]);

  return comments.flatMap((comment) => {
    const target = [...COMMENT_TARGETS.map((t) => t.column), 'spec_section_id']
      .map((column) => comment[column])
      .find((value): value is string => typeof value === 'string');
    const parent = target ? parents.get(target) : undefined;
    if (!parent) return [];
    return [
      {
        key: `comment:${parent.table}:${parent.ref}`,
        at: str(comment.created_at),
        row: {
          table: parent.table,
          ref: parent.ref,
          title: clip(parent.title, 200) ?? parent.ref,
          href: parent.href,
          detail: {
            kind: 'comment',
            field: 'comment',
            written_by: writer(comment.author as string | null),
            on: str(comment.created_at).slice(0, 10),
            excerpt: excerpt(str(comment.body), words),
          },
        },
      },
    ];
  });
}

/** The spec sections holding every word, best first, cut the way read_spec cuts them. */
async function specHits(ctx: AskContext, words: readonly string[]): Promise<AskRow[]> {
  const read = ctx.readSpec ?? readSpecFile;
  const found = await Promise.all(
    SPECS.map(async (spec) => {
      const markdown = await read(spec).catch(() => null);
      if (markdown === null) return [];
      return splitSections(markdown)
        .map((section) => ({ spec, section, ...sectionScore(section, words) }))
        .filter((m) => m.words === words.length);
    }),
  );
  return found
    .flat()
    .sort((a, b) => b.hits - a.hits)
    .slice(0, MAX_SPEC_TEXT_HITS)
    .map(({ spec, section }) =>
      sectionRow(spec, section, { kind: 'spec', field: 'section', excerpt: excerpt(section.body, words) }),
    );
}

function textKinds(input: Input): Set<DevTextKind> {
  const kinds = input.kinds;
  if (kinds === undefined || kinds === null) return new Set(DEV_TEXT_KINDS);
  if (!Array.isArray(kinds) || kinds.some((k) => !(DEV_TEXT_KINDS as readonly unknown[]).includes(k))) {
    throw new AskInputError(`kinds must be a list of ${DEV_TEXT_KINDS.join(', ')}.`);
  }
  return new Set(kinds.length > 0 ? (kinds as DevTextKind[]) : DEV_TEXT_KINDS);
}

/**
 * find_dev_text: the ideas, notes, plan steps, raises, comments and spec
 * sections whose text holds every word of the query, each with the excerpt
 * around the match and who wrote it. Search matches titles; this matches
 * what is written beneath them.
 *
 * The database is asked for the longest word, with `ilike` per column
 * (escaped, as the Dev search source escapes it), and every word is then
 * checked here at the start of a word, as read_spec checks a section. One
 * read per column rather than an `or` filter, which breaks on a comma or a
 * bracket in the query. Dismissed ideas, steps and raises are left out, and
 * so are the comments under them.
 */
export async function findDevTextLookup(ctx: AskContext, input: Input): Promise<AskToolResult> {
  const access = await devAccess(ctx);
  if (!access.ok) return access;

  const query = optionalString(input, 'query');
  const words = query ? queryWords(query) : [];
  if (!query || words.length === 0) {
    throw new AskInputError('Give a word or two to find, such as "ranking" or "drop".');
  }
  const kinds = textKinds(input);
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
  const pattern = `%${escapeLike(longest)}%`;
  const client = await ctx.db('public');

  const [columns, comments, specs] = await Promise.all([
    Promise.all(COLUMN_READS.filter((r) => kinds.has(r.kind)).map((r) => readColumn(client, ctx, r, pattern, words))),
    kinds.has('comment') ? readComments(client, ctx, pattern, words) : Promise.resolve([]),
    kinds.has('spec') ? specHits(ctx, words) : Promise.resolve([]),
  ]);

  // One hit per row, for the field that matched first; one per thread for
  // comments, the newest. Then the newest rows first.
  const seen = new Map<string, TextHit>();
  for (const hit of [...columns.flat(), ...comments]) {
    const kept = seen.get(hit.key);
    if (!kept) seen.set(hit.key, hit);
    else if (hit.key.startsWith('comment:') && hit.at > kept.at) seen.set(hit.key, hit);
  }
  const rows = [...seen.values()].sort((a, b) => b.at.localeCompare(a.at));
  const shown = rows.slice(0, MAX_DEV_TEXT_HITS).map((hit) => hit.row);

  if (shown.length === 0 && specs.length === 0) {
    return { ok: true, rows: [], note: `Nothing in the Dev rows or specs has the words "${words.join(' ')}".` };
  }
  return {
    ok: true,
    rows: [...shown, ...specs],
    note:
      rows.length > shown.length
        ? `${rows.length} rows match; the newest ${shown.length} are here. Narrow the words or the kinds for the rest.`
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Links for Dev passages recall found (plan #1321)
// ---------------------------------------------------------------------------

/**
 * The page each Dev row recall found opens on, as `[table, ref, href]`: the
 * same places find_dev_text links to. An idea, note, raise or spec section is
 * its ref run through a pattern; a step needs its number, and a question
 * still waiting lands on its card on the Dash tab, so steps take one read.
 */
export async function devRecallHrefs(
  ctx: AskContext,
  hits: readonly { sourceTable: string; sourceRef: string }[],
): Promise<[string, string, string][]> {
  const out: [string, string, string][] = [];
  const steps: string[] = [];
  for (const { sourceTable: table, sourceRef: ref } of hits) {
    if (table === 'public.ideas') out.push([table, ref, `/dev/ideas#idea-${ref}`]);
    else if (table === 'public.feedback_items') out.push([table, ref, `/dev/bugs#note-${ref}`]);
    else if (table === 'public.raised_items') out.push([table, ref, `/dev/raised#${raiseAnchor(ref)}`]);
    else if (table === SPEC_TABLE) {
      const [slug, anchor] = ref.split('#');
      out.push([table, ref, `/dev/specs/${slug}${anchor ? `#${anchor}` : ''}`]);
    } else if (table === 'public.plan_items' && UUID_IN.test(ref)) steps.push(ref);
  }
  if (steps.length > 0) {
    const client = await ctx.db('public');
    const { data, error } = await (start(client, ctx, 'plan_items', STEP_SELECT) as unknown as Filter).in('id', steps);
    if (error) throw new Error(`plan_items: ${error.message}`);
    for (const row of (data ?? []) as unknown as Row[]) out.push(['public.plan_items', row.id, stepHit(row).href]);
  }
  return out;
}
