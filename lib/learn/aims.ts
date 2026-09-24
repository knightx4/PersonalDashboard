/**
 * Learning goals, stored as rows of learn.aims (0044_aims.sql, plan #895).
 *
 * The page says Goals. The code says aims, because `goals` already means a
 * concept typed into a track (LEARN-GRAPH-SPEC).
 *
 * An aim with `listSource` null is an open subject, placed in a field or a
 * domain of the area grid. An aim with `listSource` 'level3' is the list of
 * Level 3 vital articles in learn.area_check_articles, and is never placed.
 *
 * Pure, so it can be imported from server and client code alike.
 */

import type { Depth } from './feed/depth';

/** How well the person wants to know it, as the page offers it. */
export type AimDepth = 'familiar' | 'solid' | 'deep';

export const AIM_DEPTHS: readonly AimDepth[] = ['familiar', 'solid', 'deep'];

/** A fixed list an aim can walk. Only the Level 3 vital articles so far. */
export type AimListSource = 'level3';

export type Aim = {
  id: string;
  name: string;
  about: string | null;
  depth: AimDepth;
  listSource: AimListSource | null;
  fieldId: string | null;
  domainId: string | null;
  /** Set once placement has answered, even when it left the aim out of every field. */
  placedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The columns `toAim` reads, for a `.select()`. */
export const AIM_COLUMNS =
  'id, name, about, depth, list_source, field_id, domain_id, placed_at, archived_at, created_at, updated_at';

export type AimRow = {
  id: string;
  name: string;
  about: string | null;
  depth: string;
  list_source: string | null;
  field_id: string | null;
  domain_id: string | null;
  placed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export function isAimDepth(value: unknown): value is AimDepth {
  return value === 'familiar' || value === 'solid' || value === 'deep';
}

export function toAim(row: AimRow): Aim {
  return {
    id: row.id,
    name: row.name,
    about: row.about,
    depth: isAimDepth(row.depth) ? row.depth : 'familiar',
    listSource: row.list_source === 'level3' ? 'level3' : null,
    fieldId: row.field_id,
    domainId: row.domain_id,
    placedAt: row.placed_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Where an aim sits in the area grid, as the Goals page says it (plan #898).
 *
 * `list`: the Level 3 goal, which covers every field and is never placed.
 * `field` or `domain`: placed, with the area's name.
 * `spans`: placement answered that it spans domains, so it sits in none.
 * `pending`: saved or reworded in the last few minutes and not placed yet.
 * The call runs after the save's response and takes seconds, so the page
 * checks back while any goal is pending.
 * `unplaced`: still not placed after that, because the call failed. Saving
 * any goal, or rewording this one, tries again.
 */
export type AimPlace =
  | { kind: 'list' }
  | { kind: 'field' | 'domain'; name: string }
  | { kind: 'spans' }
  | { kind: 'pending' }
  | { kind: 'unplaced' };

/** How long after a save an unplaced aim still reads as on its way. */
export const AIM_PLACING_MS = 2 * 60 * 1000;

export function aimPlace(
  aim: Pick<Aim, 'listSource' | 'fieldId' | 'domainId' | 'placedAt' | 'updatedAt'>,
  areaNames: ReadonlyMap<string, string>,
  now: number = Date.now(),
): AimPlace {
  if (aim.listSource) return { kind: 'list' };
  if (aim.placedAt) {
    if (aim.fieldId) return { kind: 'field', name: areaNames.get(aim.fieldId) ?? 'a field' };
    if (aim.domainId) return { kind: 'domain', name: areaNames.get(aim.domainId) ?? 'a domain' };
    return { kind: 'spans' };
  }
  const since = Date.parse(aim.updatedAt);
  return Number.isFinite(since) && now - since < AIM_PLACING_MS
    ? { kind: 'pending' }
    : { kind: 'unplaced' };
}

/** The Learn now card depth an aim's cards start at. */
export function cardDepthForAim(depth: AimDepth): Depth {
  switch (depth) {
    case 'familiar':
      return 'working';
    case 'solid':
      return 'advanced';
    case 'deep':
      return 'specialist';
  }
}

/** What the page calls each depth, with the line that says what it means. */
export const AIM_DEPTH_LABELS: Record<AimDepth, { label: string; means: string }> = {
  familiar: { label: 'Familiar', means: 'enough to recognise it and follow a conversation' },
  solid: { label: 'Solid', means: 'enough to use it and explain it' },
  deep: { label: 'Deep', means: 'the detail a specialist would expect' },
};

/** The ready-made goal the Goals page offers in one press. */
export const LEVEL3_AIM_NAME = 'Every Level 3 vital article';

export const AIM_NAME_MAX = 200;
export const AIM_ABOUT_MAX = 1000;

/** The fields a goal's form sends, read and checked. */
export type AimFields = { name: string; about: string | null; depth: AimDepth };

/**
 * Read a goal's name, line and depth from a form, or say what is wrong with
 * them. The limits are the table's (0044_aims.sql), checked here so the
 * person gets a sentence instead of a constraint name.
 *
 * `partial` is for an edit, which sends only the field that changed: a
 * missing field is left out of the result instead of being an error.
 */
export function parseAimFields(
  get: (key: string) => unknown,
  { partial = false }: { partial?: boolean } = {},
): { ok: true; fields: Partial<AimFields> } | { ok: false; error: string } {
  const fields: Partial<AimFields> = {};

  const name = get('name');
  if (typeof name === 'string') {
    const trimmed = name.trim();
    if (trimmed === '') return { ok: false, error: 'A goal needs a name.' };
    if (trimmed.length > AIM_NAME_MAX) {
      return { ok: false, error: `Keep the name under ${AIM_NAME_MAX} characters.` };
    }
    fields.name = trimmed;
  } else if (!partial) {
    return { ok: false, error: 'A goal needs a name.' };
  }

  const about = get('about');
  if (typeof about === 'string') {
    const trimmed = about.trim();
    if (trimmed.length > AIM_ABOUT_MAX) {
      return { ok: false, error: `Keep the line under ${AIM_ABOUT_MAX} characters.` };
    }
    fields.about = trimmed === '' ? null : trimmed;
  } else if (!partial) {
    fields.about = null;
  }

  const depth = get('depth');
  if (depth !== null && depth !== undefined) {
    if (!isAimDepth(depth)) return { ok: false, error: 'Pick familiar, solid or deep.' };
    fields.depth = depth;
  } else if (!partial) {
    fields.depth = 'familiar';
  }

  return { ok: true, fields };
}
