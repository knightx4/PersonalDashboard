import type { PositionKind } from '@/lib/learn/graph/position-prompt';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import type { ProposedStance } from '@/lib/vault/map/proposal';

/**
 * The accepted map, read for the vault's map pages (#758).
 *
 * Reads only. Nothing here calls a model or writes a row, and nothing here
 * says what the person knows: a theme is what they write about and a position
 * is what a note says, each traced to its sentence.
 *
 * A failed read throws rather than returning an empty list. An empty map has
 * its own page telling the person how to fill it, and a broken read must not
 * be mistaken for that (law 2), so the error reaches the vault's error.tsx.
 */

/** PostgREST's default row cap. A list this long is cut, and the page says so. */
export const THEME_LIST_LIMIT = 1000;

export type ThemeListRow = {
  id: string;
  name: string;
  about: string;
  notes: number;
  positions: number;
};

export type ThemeHeader = {
  id: string;
  name: string;
  about: string;
  firstSeen: string | null;
  lastSeen: string | null;
};

export type MapSource = {
  quote: string;
  /** Null when the note has since left the vault; the quote is still shown. */
  note: { path: string; title: string } | null;
};

export type MapPositionRow = {
  id: string;
  name: string;
  statement: string;
  basis: string;
  kind: PositionKind;
  stance: ProposedStance;
  ungrounded: boolean;
  sources: MapSource[];
};

export type ThemeNote = { path: string; title: string; basis: string };

export type ThemeMap = {
  theme: ThemeHeader;
  positions: MapPositionRow[];
  notes: ThemeNote[];
};

// ------------------------------------------------------------------ raw shapes

type Count = { count: number }[] | null;

type RawThemeListRow = {
  id: string;
  name: string;
  about: string;
  theme_notes: Count;
  theme_positions: Count;
};

type RawNote = { path: string; title: string; deleted_at: string | null } | null;

export type RawThemePosition = {
  positions: {
    id: string;
    name: string;
    statement: string;
    basis: string;
    kind: PositionKind;
    stance: ProposedStance;
    centrality: number | string;
    ungrounded_at: string | null;
    position_sources: { quote: string; notes: RawNote }[] | null;
  } | null;
};

export type RawThemeNote = { basis: string; notes: RawNote };

// ------------------------------------------------------------------ reads

/**
 * Every theme, strongest first. Strength is computed by
 * obsidian.refresh_theme_strength when a map is accepted and is never shown:
 * it is an ordering, and a number like 3.71 would claim a precision the
 * measure does not have (law 3). The counts are shown instead.
 */
export async function loadThemeList(
  supabase: VaultSupabaseClient,
): Promise<{ themes: ThemeListRow[]; capped: boolean }> {
  const { data, error } = await supabase
    .from('themes')
    .select('id, name, about, theme_notes(count), theme_positions(count)')
    .order('strength', { ascending: false })
    .order('name')
    .limit(THEME_LIST_LIMIT);
  if (error) throw new Error(`Could not read the map's themes: ${error.message}`);
  const themes = shapeThemeList((data ?? []) as RawThemeListRow[]);
  return { themes, capped: themes.length >= THEME_LIST_LIMIT };
}

/** One theme with its positions and notes, or null when there is no such theme. */
export async function loadThemeMap(
  supabase: VaultSupabaseClient,
  themeId: string,
): Promise<ThemeMap | null> {
  if (!UUID.test(themeId)) return null;

  const [themeRead, positionsRead, notesRead] = await Promise.all([
    supabase
      .from('themes')
      .select('id, name, about, first_seen, last_seen')
      .eq('id', themeId)
      .maybeSingle(),
    supabase
      .from('theme_positions')
      .select(
        'positions(id, name, statement, basis, kind, stance, centrality, ungrounded_at, position_sources(quote, notes(path, title, deleted_at)))',
      )
      .eq('theme_id', themeId),
    supabase
      .from('theme_notes')
      .select('basis, notes(path, title, deleted_at)')
      .eq('theme_id', themeId),
  ]);

  const failed = themeRead.error ?? positionsRead.error ?? notesRead.error;
  if (failed) throw new Error(`Could not read this theme: ${failed.message}`);
  if (!themeRead.data) return null;

  const theme = themeRead.data as {
    id: string;
    name: string;
    about: string;
    first_seen: string | null;
    last_seen: string | null;
  };

  return {
    theme: {
      id: theme.id,
      name: theme.name,
      about: theme.about,
      firstSeen: theme.first_seen,
      lastSeen: theme.last_seen,
    },
    positions: shapePositions((positionsRead.data ?? []) as unknown as RawThemePosition[]),
    notes: shapeThemeNotes((notesRead.data ?? []) as unknown as RawThemeNote[]),
  };
}

// ------------------------------------------------------------------ shaping

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An embedded `table(count)` arrives as a one-element array. */
function countOf(value: Count): number {
  return value?.[0]?.count ?? 0;
}

export function shapeThemeList(rows: RawThemeListRow[]): ThemeListRow[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    about: row.about,
    notes: countOf(row.theme_notes),
    positions: countOf(row.theme_positions),
  }));
}

/**
 * Most central first, then the one with the most sentences behind it, then by
 * name. Centrality stays 0 until the merge pass computes it, so today the
 * second key is what orders the page: a position several notes make comes
 * before one a single note makes.
 */
export function shapePositions(rows: RawThemePosition[]): MapPositionRow[] {
  const ranked = rows
    .map((row) => row.positions)
    .filter((p): p is NonNullable<RawThemePosition['positions']> => p !== null)
    .map((p) => ({
      centrality: Number(p.centrality) || 0,
      row: {
        id: p.id,
        name: p.name,
        statement: p.statement,
        basis: p.basis,
        kind: p.kind,
        stance: p.stance,
        ungrounded: p.ungrounded_at !== null,
        sources: (p.position_sources ?? [])
          .map((s) => ({ quote: s.quote, note: liveNote(s.notes) }))
          .sort(bySourceNote),
      } satisfies MapPositionRow,
    }));

  ranked.sort(
    (a, b) =>
      b.centrality - a.centrality ||
      b.row.sources.length - a.row.sources.length ||
      a.row.name.localeCompare(b.row.name),
  );
  return ranked.map((r) => r.row);
}

/** Notes still in the vault, by title. A removed note has nothing to open. */
export function shapeThemeNotes(rows: RawThemeNote[]): ThemeNote[] {
  return rows
    .flatMap((row) => {
      const note = liveNote(row.notes);
      return note ? [{ ...note, basis: row.basis }] : [];
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

function liveNote(note: RawNote): { path: string; title: string } | null {
  if (!note || note.deleted_at) return null;
  return { path: note.path, title: note.title };
}

/** Sources with a note to open first, then by the note's title. */
function bySourceNote(a: MapSource, b: MapSource): number {
  if (!a.note || !b.note) return a.note ? -1 : b.note ? 1 : 0;
  return a.note.title.localeCompare(b.note.title);
}
