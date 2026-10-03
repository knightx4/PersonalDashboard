/**
 * A request filed on three pages, turned into one proposed rule (plan #1526,
 * docs/SPEC-LAYER-SPEC.md part 5).
 *
 * The notes routine reads each new note against the notes of the last 30
 * days. Whether two notes ask for the same thing is its judgement, made while
 * reading them. What it hands here is one group it judged alike, and this
 * decides whether the group is a missing rule and writes the rows if it is:
 *
 * - the group has to span three different pages within the window, or each
 *   note is still fixed on its own page, as before;
 * - one statement drafts the spec change, files the `missing_rule` finding the
 *   spec page shows (lib/specs/findings.ts), and links the notes to the
 *   change, with the same guard the spec audit uses so a sixth proposed change
 *   is never drafted;
 * - when five are already waiting, the finding is still filed, with no change,
 *   and the notes are left as they were for the next run.
 *
 * Pure, so the routine's procedure can be tested against a fixture.
 * scripts/note-rule.ts is the command around it, and .claude/skills/notes
 * ("Requests that point at a missing rule") the procedure.
 */

import { sqlText } from '@/lib/plan/overhaul-opening';
import { countChangedLines, MAX_CHANGED_LINES } from './changes';

/** How far back a note counts towards a rule. */
export const RULE_WINDOW_DAYS = 30;

/** How many different pages have to ask before it is a rule. */
export const RULE_MIN_PAGES = 3;

/** The most proposed spec changes ever waiting on the person. */
export const MAX_WAITING_CHANGES = 5;

/** A note as the routine read it from feedback_items. */
export type RuleNote = {
  id: string;
  kind: string;
  status: string;
  page_path: string | null;
  created_at: string;
  spec_change_id: string | null;
};

/**
 * The page a note was filed on, without its query or trailing slash, so
 * `/todo?view=week` and `/todo/` are both `/todo`. Null for a note with no
 * page, and for a surface note (`/preview?s=…`), which is worked by the law it
 * breaks rather than here.
 */
export function notePage(path: string | null): string | null {
  if (!path) return null;
  const trimmed = path.trim();
  if (trimmed.startsWith('/preview?s=')) return null;
  const bare = trimmed.split(/[?#]/)[0].replace(/\/+$/, '');
  return bare || '/';
}

export type RuleCheck = {
  /** True when the notes that count span RULE_MIN_PAGES pages or more. */
  ok: boolean;
  /** The notes that count, oldest first. */
  notes: RuleNote[];
  /** Their pages, in the order first asked. */
  pages: string[];
  /** Each note that does not count, and why. */
  leftOut: { id: string; why: string }[];
  /** Why the group is not a rule, when it is not. */
  why: string | null;
};

const OPEN = new Set(['open', 'in_progress', 'blocked']);

/**
 * Whether a group of notes the routine judged alike is a missing rule.
 * A like, a surface note, a note older than the window and a note already
 * waiting on a change do not count. Of the rest, at least one has to be open,
 * since the check runs on new notes and a group that is all closed has
 * nothing new to say.
 */
export function checkRuleRequest(notes: readonly RuleNote[], now: Date): RuleCheck {
  const since = now.getTime() - RULE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const counted: RuleNote[] = [];
  const leftOut: { id: string; why: string }[] = [];
  const seen = new Set<string>();

  for (const note of notes) {
    if (seen.has(note.id)) continue;
    seen.add(note.id);
    if (note.kind === 'like') leftOut.push({ id: note.id, why: 'a like asks for nothing' });
    else if (notePage(note.page_path) === null)
      leftOut.push({ id: note.id, why: 'no page, or a surface note worked by its law' });
    else if (new Date(note.created_at).getTime() < since)
      leftOut.push({ id: note.id, why: `filed more than ${RULE_WINDOW_DAYS} days ago` });
    else if (note.spec_change_id)
      leftOut.push({ id: note.id, why: 'already linked to a spec change' });
    else counted.push(note);
  }

  counted.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const pages = [...new Set(counted.map((note) => notePage(note.page_path) as string))];

  let why: string | null = null;
  if (pages.length < RULE_MIN_PAGES) {
    why =
      `These notes are on ${pages.length} page${pages.length === 1 ? '' : 's'}, and a rule ` +
      `needs ${RULE_MIN_PAGES}, so each is fixed on its page.`;
  } else if (!counted.some((note) => OPEN.has(note.status))) {
    why = 'Every one of these notes is already closed, so there is nothing new to propose.';
  }
  return { ok: why === null, notes: counted, pages, leftOut, why };
}

/** The finding's evidence: each note's short id, page and date, oldest first. */
export function ruleEvidence(notes: readonly RuleNote[]): string {
  const cited = notes.map(
    (note) => `${note.id.slice(0, 8)} on ${notePage(note.page_path)} (${note.created_at.slice(0, 10)})`,
  );
  return `Notes ${cited.join(', ')}.`;
}

export type NoteRuleInput = {
  userId: string;
  /** The spec the rule goes in: a registry slug, or a workspace id with no spec. */
  spec: string;
  /** The heading the rule belongs under, usually "Rules"; null for the whole spec. */
  section: string | null;
  /** What the notes keep asking for, in one or two sentences. */
  finding: string;
  /** The session writing it (the cse_… id), or null. */
  sessionId: string | null;
  /** The notes checkRuleRequest counted. */
  notes: readonly RuleNote[];
  change: { title: string; why: string; diff: string };
};

/** What is wrong with a draft before the database sees it, or null. */
export function noteRuleProblem(input: NoteRuleInput): string | null {
  if (!input.spec.trim()) return 'The spec is blank.';
  if (!input.finding.trim()) return 'The finding is blank.';
  const title = input.change.title.trim();
  if (!title || title.length > 120) return 'The title must be 1 to 120 characters.';
  const why = input.change.why.trim();
  if (!why || why.length > 2000) return 'The why must be 1 to 2,000 characters.';
  const lines = countChangedLines(input.change.diff);
  if (lines < 1 || lines > MAX_CHANGED_LINES) {
    return `The diff changes ${lines} lines; it must change 1 to ${MAX_CHANGED_LINES}.`;
  }
  if (input.notes.length === 0) return 'No notes to link.';
  return null;
}

/**
 * One statement that drafts the change while fewer than five are waiting,
 * files the finding (with the change, or with none when there is no room),
 * and links the notes to the change. Open notes move to `planned` with a
 * line saying what they wait on; a note already closed keeps its status and
 * is linked as evidence. It returns the change id (null when five were
 * waiting), the finding id and how many notes were linked.
 */
export function noteRuleSql(input: NoteRuleInput): string {
  const user = sqlText(input.userId);
  const ids = input.notes.map((note) => sqlText(note.id)).join(', ');
  const waiting =
    `Waiting on the proposed rule "${input.change.title.trim()}" on /dev/specs, ` +
    'since the same thing was asked on other pages too.';
  return [
    'with change as (',
    '  insert into spec_changes (user_id, spec, title, why, diff, made_by)',
    `  select ${user}, ${sqlText(input.spec)}, ${sqlText(input.change.title.trim())},`,
    `         ${sqlText(input.change.why.trim())}, ${sqlText(input.change.diff)}, 'claude'`,
    `  where (select count(*) from spec_changes where user_id = ${user}`,
    `         and status = 'proposed') < ${MAX_WAITING_CHANGES}`,
    '  returning id',
    '), finding as (',
    '  insert into spec_findings (user_id, audit_id, session_id, spec, section, kind,',
    '                             finding, evidence, proposal, spec_change_id)',
    `  select ${user}, null, ${sqlText(input.sessionId)}, ${sqlText(input.spec)},`,
    `         ${sqlText(input.section)}, 'missing_rule', ${sqlText(input.finding.trim())},`,
    `         ${sqlText(ruleEvidence(input.notes))}, 'change_spec', (select id from change)`,
    '  returning id',
    '), linked as (',
    '  update feedback_items set spec_change_id = (select id from change),',
    "    status = case when status in ('open', 'in_progress', 'blocked')",
    "                  then 'planned'::feedback_status else status end,",
    "    resolution_note = case when status in ('open', 'in_progress', 'blocked')",
    `                  then ${sqlText(waiting)} else resolution_note end`,
    `  where user_id = ${user} and id in (${ids}) and spec_change_id is null`,
    '    and exists (select 1 from change)',
    '  returning id',
    ')',
    'select (select id from change) as change_id, (select id from finding) as finding_id,',
    '       (select count(*) from linked)::int as notes_linked;',
  ].join('\n');
}
