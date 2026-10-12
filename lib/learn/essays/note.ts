/**
 * The essay as a vault note (docs/LEARN-ESSAYS-SPEC.md, "The essay note";
 * plan #1866, under #1863).
 *
 * Every essay is a markdown note in the vault's `Essays/` folder whose
 * frontmatter says `type: essay`. The editor holds the text only; the
 * frontmatter is built here when the note is first written, and on later
 * saves only `title` and `updated` are rewritten, so a tag or a confidence
 * the person set in Obsidian is kept byte for byte.
 *
 * Pure: no database and no repository, so all of it is tested.
 */

/** The vault folder new essays are written into. */
export const ESSAYS_FOLDER = 'Essays';

export const ESSAY_STAGES = ['draft', 'seedling', 'budding', 'evergreen'] as const;
export type EssayStage = (typeof ESSAY_STAGES)[number];

export const ESSAY_CONFIDENCE = [
  'certain',
  'highly likely',
  'likely',
  'possible',
  'unlikely',
  'highly unlikely',
  'remote',
] as const;
export type EssayConfidence = (typeof ESSAY_CONFIDENCE)[number];

/** The frontmatter the spec lists, in its order. Dates are `YYYY-MM-DD`. */
export type EssayFrontmatter = {
  title: string;
  type: 'essay';
  stage: EssayStage;
  publish: boolean;
  slug: string;
  description: string;
  created: string;
  updated: string;
  /** Set the first time the essay is published; null until then. */
  published: string | null;
  tags: string[];
  /** Optional; left out of the note when null. */
  confidence: EssayConfidence | null;
  /** Wikilinks (`[[Note]]`) or URLs. */
  sources: string[];
};

/** The frontmatter a new essay's note starts with. */
export function newEssayFrontmatter(opts: {
  title: string;
  slug: string;
  description: string;
  today: string;
}): EssayFrontmatter {
  return {
    title: opts.title,
    type: 'essay',
    stage: 'draft',
    publish: false,
    slug: opts.slug,
    description: oneLine(opts.description),
    created: opts.today,
    updated: opts.today,
    published: null,
    tags: [],
    confidence: null,
    sources: [],
  };
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A YAML scalar as a double-quoted string. JSON's string syntax is a subset
 * of YAML's double-quoted style, so this is always valid, and it quotes the
 * `[[wikilinks]]` Obsidian requires quoted.
 */
function quoted(text: string): string {
  return JSON.stringify(text);
}

function list(items: string[]): string {
  return `[${items.map(quoted).join(', ')}]`;
}

/** The frontmatter block, from the opening `---` to the closing one and its newline. */
export function buildEssayFrontmatter(fm: EssayFrontmatter): string {
  const lines = [
    `title: ${quoted(fm.title)}`,
    'type: essay',
    `stage: ${fm.stage}`,
    `publish: ${fm.publish ? 'true' : 'false'}`,
    `slug: ${fm.slug}`,
    `description: ${quoted(fm.description)}`,
    `created: ${fm.created}`,
    `updated: ${fm.updated}`,
    `published:${fm.published ? ` ${fm.published}` : ''}`,
    `tags: ${list(fm.tags)}`,
  ];
  if (fm.confidence) lines.push(`confidence: ${fm.confidence}`);
  lines.push(`sources: ${list(fm.sources)}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

/**
 * The note's body as it is written: leading blank lines dropped, as the
 * vault's parser drops them, and one newline at the end. Writing the body
 * the parser would read back means a save with nothing new makes no commit.
 */
export function essayNoteBody(draft: string): string {
  const trimmed = draft.replace(/\r\n/g, '\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n` : '';
}

/** The whole file for a new essay note: frontmatter, a blank line, the body. */
export function essayNoteText(fm: EssayFrontmatter, draft: string): string {
  return `${buildEssayFrontmatter(fm)}\n${essayNoteBody(draft)}`;
}

/** A frontmatter block at the very start of a file, with its closing line. */
const BLOCK = /^---\r?\n([\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

/**
 * The file with `title` and `updated` rewritten in its frontmatter and its
 * body replaced. Every other line of the frontmatter is kept as it was. A
 * file with no frontmatter (someone removed it in Obsidian) gets a fresh
 * block from `fresh`, so the note is still found as an essay.
 */
export function rewriteEssayFile(
  raw: string,
  body: string,
  change: { title: string; updated: string },
  fresh: EssayFrontmatter,
): string {
  const match = raw.match(BLOCK);
  if (!match) return essayNoteText({ ...fresh, title: change.title, updated: change.updated }, body);

  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const inner = (match[1] ?? '').replace(/\r?\n$/, '');
  const lines = inner ? inner.split(/\r?\n/) : [];
  const set = (key: string, value: string) => {
    const at = lines.findIndex((line) => line.startsWith(`${key}:`));
    const line = `${key}: ${value}`;
    if (at >= 0) lines[at] = line;
    else lines.push(line);
  };
  set('title', quoted(change.title));
  set('updated', change.updated);

  const text = `---${eol}${lines.join(eol)}${eol}---${eol}${eol}${essayNoteBody(body)}`;
  return eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text;
}

/** A frontmatter date as `YYYY-MM-DD`, whether the parser gave a Date or a string. */
function day(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) return value.trim().slice(0, 10);
  return null;
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((s) => s.trim());
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

/**
 * The essay's frontmatter from the parsed note (the vault parser's
 * `frontmatter`, which reads unquoted dates as Dates), or null when the note
 * is not an essay. Anything missing or malformed takes the default a new
 * essay would have.
 */
export function readEssayFrontmatter(
  data: Record<string, unknown>,
  fallback: { title: string; today: string },
): EssayFrontmatter | null {
  if (data.type !== 'essay') return null;
  const created = day(data.created) ?? fallback.today;
  return {
    title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : fallback.title,
    type: 'essay',
    stage: isOneOf(ESSAY_STAGES, data.stage) ? data.stage : 'draft',
    publish: data.publish === true,
    slug: typeof data.slug === 'string' ? data.slug.trim() : '',
    description: typeof data.description === 'string' ? oneLine(data.description) : '',
    created,
    updated: day(data.updated) ?? created,
    published: day(data.published),
    tags: strings(data.tags),
    confidence: isOneOf(ESSAY_CONFIDENCE, data.confidence) ? data.confidence : null,
    sources: strings(data.sources),
  };
}

/** Words a slug leaves out, so "Why money is the odd good out" is `money-odd-good-out`. */
const SLUG_SKIP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'of', 'to', 'in', 'on', 'at', 'for', 'and', 'or',
  'but', 'why', 'how', 'what', 'when', 'where', 'who', 'which', 'do', 'does', 'did', 'it', 'its',
]);

/** Longest slug, cut at a word. */
const SLUG_MAX = 60;

/**
 * The essay's web address from its title: lower case, letters and digits
 * only, small words dropped, joined by hyphens and cut at a word. Falls back
 * to all the words when dropping them leaves nothing, and to "essay".
 */
export function essaySlug(title: string): string {
  const words = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const kept = words.filter((word) => !SLUG_SKIP.has(word));
  let slug = '';
  for (const word of kept.length ? kept : words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > SLUG_MAX) break;
    slug = next;
  }
  return slug || 'essay';
}

/** `base`, or `base-2`, `base-3`… when the person already has an essay at it. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const slug = `${base}-${n}`;
    if (!taken.has(slug)) return slug;
  }
}

/** Today as `YYYY-MM-DD` in a time zone, falling back to UTC for one Intl does not know. */
export function essayDay(now: Date, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
