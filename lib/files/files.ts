/**
 * Files: a piece of writing kept as its own page (supabase/migrations/0105).
 *
 * A file is markdown with a title, an optional summary, and every version kept.
 * Claude writes one when what a step produced is longer than a few lines or
 * worth coming back to, and links it from the step and the goal through
 * goals.links (kind 'file'). The step's own result then stays short and
 * points here.
 *
 * Pure, so the rows and the wording are tested without a database. The reads
 * are in lib/files/store.ts.
 */

export type FileAuthor = 'claude' | 'you';

/** One file as the list shows it: no body. */
export type FileListing = {
  id: string;
  title: string;
  summary: string | null;
  madeBy: FileAuthor;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** One file as its page shows it. */
export type FileDoc = FileListing & {
  body: string;
  origin: string | null;
  changeNote: string | null;
};

/** An earlier version, as the history under a file lists it. */
export type FileVersion = {
  version: number;
  title: string;
  madeBy: FileAuthor;
  changeNote: string | null;
  createdAt: string;
};

/** A file as a goal or a step links to it. */
export type LinkedFile = {
  linkId: string;
  fileId: string;
  title: string;
  summary: string | null;
  updatedAt: string;
};

export const LISTING_COLUMNS = 'id, title, summary, made_by, version, created_at, updated_at';
export const DOC_COLUMNS = `${LISTING_COLUMNS}, body, origin, change_note`;
export const VERSION_COLUMNS = 'version, title, made_by, change_note, created_at';

export type ListingRow = {
  id: string;
  title: string;
  summary: string | null;
  made_by: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type DocRow = ListingRow & { body: string; origin: string | null; change_note: string | null };

export type VersionRow = {
  version: number;
  title: string;
  made_by: string;
  change_note: string | null;
  created_at: string;
};

function author(value: string): FileAuthor {
  return value === 'claude' ? 'claude' : 'you';
}

export function toListing(row: ListingRow): FileListing {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    madeBy: author(row.made_by),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toDoc(row: DocRow): FileDoc {
  return { ...toListing(row), body: row.body, origin: row.origin, changeNote: row.change_note };
}

export function toVersion(row: VersionRow): FileVersion {
  return {
    version: row.version,
    title: row.title,
    madeBy: author(row.made_by),
    changeNote: row.change_note,
    createdAt: row.created_at,
  };
}

/** Where a file opens. */
export function fileHref(id: string): string {
  return `/goals/files/${id}`;
}

/** Where one earlier version of a file opens. */
export function fileVersionHref(id: string, version: number): string {
  return `${fileHref(id)}?v=${version}`;
}

/** The `?v=` on a file's page as a version number, or null for the newest. */
export function parseVersion(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d{1,6}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 ? n : null;
}

/**
 * Where a file came from, when it is a goals item: the step or goal id in
 * `goals.items:<id>`. Anything else is not a place in the app this can open.
 */
export function originItemId(origin: string | null): string | null {
  const match = origin?.match(/^goals\.items:([0-9a-f-]{36})$/i);
  return match ? match[1] : null;
}

/** Who wrote it and which version it is, for the line under the title. */
export function authorLine(file: Pick<FileListing, 'madeBy' | 'version'>): string {
  const who = file.madeBy === 'claude' ? 'Written by Dash' : 'Written by you';
  return file.version > 1 ? `${who} · version ${file.version}` : who;
}
