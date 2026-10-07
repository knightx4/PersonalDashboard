import { countChangedLines, MAX_CHANGED_LINES } from './changes';
import { parseRules } from './rules';
import { APP_VISION, visionAnchor, type VisionScope } from './vision';

/**
 * Turning what Dash drafted from an interview into the two proposals it
 * leaves (plan #1640, feature #1637): which spec the draft goes into, the
 * diff that writes it there, and the sentences that cite the interview.
 *
 * Pure, so the shape of a drafted spec can be tested without a model or a
 * database. The model call is lib/dash/interview-draft.ts and the writes are
 * draftInterview in lib/specs/interview-run.ts.
 *
 * Where the spec goes:
 * - A workspace with no spec gets a new one, `docs/<WORKSPACE>-SPEC.md`,
 *   under the workspace's id as its slug.
 * - A workspace with specs has the draft added to the end of one of them,
 *   the one Dash picks, and its rules added to that spec's `## Rules`
 *   section, numbered on from the last.
 * - The app as a whole has a spec of its own, slug `app` (APP-SPEC.md): a
 *   new one until that exists. The app-wide specs in the registry are about
 *   how the app is built, not what it is for, so the draft is not added to
 *   any of them.
 *
 * Every rule a draft writes is checked by the audit, the one check that
 * needs nothing built (lib/specs/rules.ts).
 */

/** The spec a draft goes into. */
export type DraftTarget = {
  slug: string;
  /** Its file under docs/. */
  file: string;
  /** Null for a spec the draft creates. */
  title: string | null;
};

/** What the registry says about a spec, as far as drafting needs it. */
export type DraftSpecDoc = { slug: string; title: string; file: string; module: string | null };

/** The slug the app's own spec has, or will have once the first draft is approved. */
export const APP_SPEC_SLUG = 'app';

/** The file a spec the draft creates is given. */
export function newSpecFile(slug: string): string {
  return `${slug.toUpperCase()}-SPEC.md`;
}

/**
 * The specs a draft for this scope may go into: the workspace's own, or the
 * app's own spec when there is one. Empty when the draft creates a spec.
 */
export function draftCandidates(scope: VisionScope, specs: readonly DraftSpecDoc[]): DraftTarget[] {
  const mine =
    scope === APP_VISION
      ? specs.filter((spec) => spec.slug === APP_SPEC_SLUG)
      : specs.filter((spec) => spec.module === scope);
  return mine.map((spec) => ({ slug: spec.slug, file: spec.file, title: spec.title }));
}

/** The spec a draft creates for a scope with none: its slug is the scope's id. */
export function newSpecTarget(scope: VisionScope, specs: readonly DraftSpecDoc[]): DraftTarget {
  const taken = new Set(specs.map((spec) => spec.slug));
  const base = scope === APP_VISION ? APP_SPEC_SLUG : scope;
  const slug = taken.has(base) ? `${base}-workspace` : base;
  return { slug, file: newSpecFile(slug), title: null };
}

/** One section of the draft, under its own `##` heading. */
export type DraftSection = { heading: string; body: string };

/** What the model drafted for the spec, before it becomes a diff. */
export type SpecDraftContent = {
  sections: DraftSection[];
  /** Each one sentence, numbered and given "Checked by: audit." here. */
  rules: string[];
};

function cleanLines(text: string): string[] {
  const lines = text.replace(/\r/g, '').split('\n').map((line) => line.trimEnd());
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  // Never more than one blank line in a row: each one costs a changed line.
  return lines.filter((line, i) => !(line === '' && lines[i - 1] === ''));
}

/** The heading without hashes or a trailing colon. */
function cleanHeading(heading: string): string {
  return heading.replace(/^#+\s*/, '').replace(/:\s*$/, '').replace(/\s+/g, ' ').trim();
}

function sectionLines(sections: readonly DraftSection[]): string[] {
  const out: string[] = [];
  for (const section of sections) {
    const heading = cleanHeading(section.heading);
    const body = cleanLines(section.body).filter((line) => !/^#{1,2}\s/.test(line));
    if (!heading || body.length === 0) continue;
    if (/^rules$/i.test(heading)) continue;
    if (out.length > 0) out.push('');
    out.push(`## ${heading}`, '', ...body);
  }
  return out;
}

/** The rules as the spec holds them, numbered from `first`. */
export function ruleLines(rules: readonly string[], first: number): string[] {
  const out: string[] = [];
  rules
    .map((rule) => rule.replace(/\s+/g, ' ').replace(/^\*\*R\d+\.\*\*\s*/, '').trim())
    .filter((rule) => rule !== '')
    .forEach((rule, i) => {
      if (i > 0) out.push('');
      out.push(`**R${first + i}.** ${rule}`, 'Checked by: audit.');
    });
  return out;
}

/** True for a `##` heading line (not `###`). */
function isSectionHeading(line: string): boolean {
  return /^##\s+\S/.test(line) && !/^###/.test(line);
}

/** Line indexes of every `##` heading outside a code fence. */
function headingIndexes(lines: readonly string[]): number[] {
  const out: number[] = [];
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && isSectionHeading(line)) out.push(i);
  });
  return out;
}

/** Lines are inserted before `at`, an index into the spec's lines. */
type Insert = { at: number; lines: string[] };

/** Where `want` first runs in `have` at or after `from`, ignoring trailing space. */
function firstRun(have: readonly string[], want: readonly string[], from: number): number {
  for (let at = from; at + want.length <= have.length; at++) {
    if (want.every((line, k) => have[at + k].trimEnd() === line.trimEnd())) return at;
  }
  return -1;
}

/**
 * A unified diff inserting lines into a spec. Each hunk carries the lines
 * just before its insertion as context, as many as it takes (three at least,
 * when there are three) for that run to be the first of its kind after the
 * hunk before, since rebaseDiff places a hunk at the first place its context
 * appears.
 */
function insertionDiff(file: string, spec: readonly string[], inserts: Insert[]): string {
  const out = [`--- a/docs/${file}`, `+++ b/docs/${file}`];
  let previous = 0;
  let offset = 0;
  for (const insert of [...inserts].sort((a, b) => a.at - b.at)) {
    let start = Math.max(previous, insert.at - 3);
    while (start > previous && firstRun(spec, spec.slice(start, insert.at), previous) !== start) start--;
    const context = spec.slice(start, insert.at);
    const oldStart = start + 1;
    const newCount = context.length + insert.lines.length;
    out.push(`@@ -${oldStart},${context.length} +${oldStart + offset},${newCount} @@`);
    out.push(...context.map((line) => ` ${line}`), ...insert.lines.map((line) => `+${line}`));
    offset += insert.lines.length;
    previous = insert.at;
  }
  return `${out.join('\n')}\n`;
}

/**
 * The diff a draft becomes. `markdown` is the spec as it stands, or null for
 * a spec the draft creates, which then opens with `# <heading>`.
 */
export function specDraftDiff(input: {
  target: DraftTarget;
  markdown: string | null;
  /** The new spec's title line; ignored when the spec exists. */
  heading: string;
  draft: SpecDraftContent;
}): string {
  const { target, markdown, draft } = input;
  const sections = sectionLines(draft.sections);

  if (markdown === null) {
    const rules = ruleLines(draft.rules, 1);
    const lines = [`# ${input.heading.trim()}`, '', ...sections];
    if (rules.length > 0) lines.push('', '## Rules', '', ...rules);
    return (
      [`--- /dev/null`, `+++ b/docs/${target.file}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join(
        '\n',
      ) + '\n'
    );
  }

  const spec = markdown.replace(/\r/g, '').split('\n');
  let end = spec.length;
  while (end > 0 && spec[end - 1].trim() === '') end--;

  const headings = headingIndexes(spec);
  const rulesAt = headings.find((i) => /^##\s+rules\s*$/i.test(spec[i]));
  const parsed = parseRules(markdown);
  const first = parsed.rules.reduce((max, rule) => Math.max(max, rule.number), 0) + 1;
  const rules = ruleLines(draft.rules, first);

  const inserts: Insert[] = [];
  if (rulesAt === undefined) {
    const lines = [...sections];
    if (rules.length > 0) lines.push(...(lines.length > 0 ? [''] : []), '## Rules', '', ...rules);
    if (lines.length > 0) inserts.push({ at: end, lines: ['', ...lines] });
  } else {
    let rulesEnd = headings.find((i) => i > rulesAt) ?? spec.length;
    while (rulesEnd > rulesAt + 1 && spec[rulesEnd - 1].trim() === '') rulesEnd--;
    if (rulesEnd === end) {
      const lines = [...rules];
      if (sections.length > 0) lines.push(...(lines.length > 0 ? [''] : []), ...sections);
      if (lines.length > 0) inserts.push({ at: end, lines: ['', ...lines] });
    } else {
      if (rules.length > 0) inserts.push({ at: rulesEnd, lines: ['', ...rules] });
      if (sections.length > 0) inserts.push({ at: end, lines: ['', ...sections] });
    }
  }
  if (inserts.length === 0) return '';
  return insertionDiff(target.file, spec, inserts);
}

/** Whether the draft's diff is one the database will take. */
export function draftFits(diff: string): { ok: true } | { ok: false; lines: number } {
  const lines = countChangedLines(diff);
  return lines >= 1 && lines <= MAX_CHANGED_LINES ? { ok: true } : { ok: false, lines };
}

/** "7 October 2026", from a YYYY-MM-DD day. */
export function spelledDate(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

/** The sentence both proposals carry, naming the interview they came from. */
export function interviewCitation(label: string, day: string): string {
  return `Drafted from your interview about ${label} on ${spelledDate(day)}.`;
}

/** The why on spec_changes is at most 2000 characters; the vision note has no cap but is kept short. */
const WHY_MAX = 2000;
const NOTE_MAX = 1500;

function clipTo(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/** The spec change's why: the citation first, then the answers it quotes. */
export function draftWhy(citation: string, why: string): string {
  return clipTo(`${citation} ${why.trim()}`, WHY_MAX);
}

/**
 * The vision edit's note: the citation, Dash's reason, and, when the edit
 * takes the place of one the weekly review proposed, that it folds that in.
 */
export function draftVisionNote(input: { citation: string; why: string; foldedFrom: string | null }): string {
  const folded = input.foldedFrom
    ? ` It takes the place of the edit the weekly review proposed on ${spelledDate(input.foldedFrom.slice(0, 10))}, and keeps what still held of it.`
    : '';
  return clipTo(`${input.citation} ${input.why.trim()}${folded}`, NOTE_MAX);
}

/** Where the specs page shows a workspace's vision and any edit waiting under it. */
export function visionDraftHref(scope: VisionScope): string {
  return `/dev/specs#${visionAnchor(scope)}`;
}

/**
 * Where a link to one spec change lands, on /dev/specs: the same id
 * SpecChangeCard (app/dev/specs/spec-change-card.tsx) gives its row, which
 * keeps its own copy since that file is a client module.
 */
export function specChangeAnchor(id: string): string {
  return `spec-change-${id}`;
}

export function specChangeHref(id: string): string {
  return `/dev/specs#${specChangeAnchor(id)}`;
}
