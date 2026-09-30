import { SPECS, readSpec as readSpecFile, specBySlug, type SpecDoc } from '@/lib/specs/registry';
import { splitSections, type SpecSection } from '@/lib/specs/sections';
import { firstLine, planHref, raiseAnchor, waitingAnchor } from '@/lib/search/sources/dev-map';
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
function writer(author: string | null | undefined): string {
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
