/**
 * The kinds of weekly help a goal asks for (plan #1027).
 *
 * Each goal names the help the weekly run should find for it, from a fixed
 * set, with a note on what to look for: the city goal asks for events and
 * volunteer openings, "Brooklyn, weeknights". Stored on the goal as
 * goals.items.help_kinds, a JSON array of { kind, note } in the order they
 * were chosen (supabase/migrations-goals/0019). The database refuses a kind
 * not listed here, a kind twice, and a note over HELP_NOTE_MAX, so the two
 * lists change together.
 *
 * The weekly run (plan #1028) and mapping (plan #1029) read and write the
 * same shape; readHelpKinds is the one way to turn a stored value back into
 * it.
 */

export const HELP_KINDS = ['events', 'volunteering', 'reading', 'courses', 'job_leads'] as const;

export type HelpKind = (typeof HELP_KINDS)[number];

export const HELP_KIND_LABELS: Record<HelpKind, string> = {
  events: 'Events',
  volunteering: 'Volunteer openings',
  reading: 'Reading',
  courses: 'Courses',
  job_leads: 'Job leads',
};

/** The limit the table's check sets. */
export const HELP_NOTE_MAX = 200;

export type HelpKindChoice = { kind: HelpKind; note: string | null };

export function isHelpKind(value: unknown): value is HelpKind {
  return typeof value === 'string' && (HELP_KINDS as readonly string[]).includes(value);
}

function clean(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value === '' ? null : value;
}

/**
 * The stored column as the app's shape. Anything that is not a known kind is
 * skipped rather than thrown on, and a kind seen twice keeps its first entry,
 * so a value written by hand never breaks the goal page.
 */
export function readHelpKinds(raw: unknown): HelpKindChoice[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<HelpKind>();
  const out: HelpKindChoice[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { kind, note } = entry as { kind?: unknown; note?: unknown };
    if (!isHelpKind(kind) || seen.has(kind)) continue;
    seen.add(kind);
    out.push({ kind, note: clean(note) });
  }
  return out;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * The goal page's form: a checkbox named `kind` per kind ticked, and a
 * `note:<kind>` field beside each. The result is in the fixed order of
 * HELP_KINDS, whatever order the form sent them in. Nothing ticked is an
 * empty list, which asks the weekly run for nothing.
 */
export function parseHelpKindFields(
  getAll: (key: string) => unknown[],
  get: (key: string) => unknown,
): Parsed<HelpKindChoice[]> {
  const ticked = new Set<HelpKind>();
  for (const raw of getAll('kind')) {
    if (!isHelpKind(raw)) return { ok: false, error: 'That is not one of the kinds of help.' };
    ticked.add(raw);
  }
  const value: HelpKindChoice[] = [];
  for (const kind of HELP_KINDS) {
    if (!ticked.has(kind)) continue;
    const note = clean(get(`note:${kind}`));
    if (note && note.length > HELP_NOTE_MAX) {
      return {
        ok: false,
        error: `Keep the note on ${HELP_KIND_LABELS[kind].toLowerCase()} under ${HELP_NOTE_MAX} characters.`,
      };
    }
    value.push({ kind, note });
  }
  return { ok: true, value };
}

/** One line for the goal page: "Events (Brooklyn, weeknights), Reading". */
export function helpKindsLine(choices: HelpKindChoice[]): string {
  return choices
    .map(({ kind, note }) => (note ? `${HELP_KIND_LABELS[kind]} (${note})` : HELP_KIND_LABELS[kind]))
    .join(', ');
}
