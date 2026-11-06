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
  /** Where it came from, as `schema.table:ref`: usually the step that asked for it. */
  origin: string | null;
  createdAt: string;
  updatedAt: string;
  /** When they last opened it; null while the current version is unread (plan #1861). */
  readAt: string | null;
  /** A file the person added (plan #2778.7): where it is kept, and its type. */
  stored?: StoredFile | null;
  /** When it was pinned to the top of its goal's files (plan #2778.7). */
  pinnedAt?: string | null;
};

/** Where a file the person added is kept, in the goals-documents bucket (migration 0290). */
export type StoredFile = { path: string; contentType: string; sizeBytes: number };

/**
 * What a file's body is (core migration 0305): markdown, a piece of writing;
 * or html, a self-contained page a bot had made (plan #2997), which opens in
 * a sandbox at fileViewHref.
 */
export type FileFormat = 'markdown' | 'html';

/** One file as its page shows it. */
export type FileDoc = FileListing & {
  body: string;
  changeNote: string | null;
  format: FileFormat;
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
  /** The step or goal it was written for, as `goals.items:<id>` (plan #1860). */
  origin?: string | null;
  madeBy?: FileAuthor;
  version?: number;
  /** When they last opened it; null while unread (plan #1861). */
  readAt?: string | null;
  /** A file the person added rather than a piece of writing (plan #2778.7). */
  stored?: StoredFile | null;
  pinnedAt?: string | null;
  /** The kind of document the link says the file is (goals migration 0093). */
  documentKindId?: string | null;
};

export const LISTING_COLUMNS =
  'id, title, summary, made_by, version, origin, created_at, updated_at, read_at, storage_path, content_type, size_bytes, pinned_at';
export const DOC_COLUMNS = `${LISTING_COLUMNS}, body, change_note, format`;
export const VERSION_COLUMNS = 'version, title, made_by, change_note, created_at';

export type ListingRow = {
  id: string;
  title: string;
  summary: string | null;
  made_by: string;
  version: number;
  origin: string | null;
  created_at: string;
  updated_at: string;
  read_at?: string | null;
  storage_path?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  pinned_at?: string | null;
};

export type DocRow = ListingRow & { body: string; change_note: string | null; format?: string | null };

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
    origin: row.origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readAt: row.read_at ?? null,
    stored:
      row.storage_path && row.content_type
        ? { path: row.storage_path, contentType: row.content_type, sizeBytes: row.size_bytes ?? 0 }
        : null,
    pinnedAt: row.pinned_at ?? null,
  };
}

export function toDoc(row: DocRow): FileDoc {
  return { ...toListing(row), body: row.body, changeNote: row.change_note, format: row.format === 'html' ? 'html' : 'markdown' };
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

/**
 * Whether a file is still to read (plan #1861): Dash wrote it and the current
 * version has not been opened. A file they wrote themselves is never unread.
 * core.files.read_at is cleared by each new version (migration 0203).
 */
export function isUnread(file: { madeBy?: FileAuthor; readAt?: string | null }): boolean {
  return file.madeBy === 'claude' && !file.readAt;
}

/** Where a file opens. */
export function fileHref(id: string): string {
  return `/goals/files/${id}`;
}

/**
 * Where an html file's page itself is served (plan #2997), sandboxed, for its
 * file page to frame and for a link to open full screen. With a version, that
 * version's page.
 */
export function fileViewHref(id: string, version?: number | null): string {
  return version ? `${fileHref(id)}/view?v=${version}` : `${fileHref(id)}/view`;
}

/**
 * The headers an html file is served with (plan #2997). The page runs its own
 * scripts and styles in a sandbox with an origin of its own, so it cannot
 * read the app's cookies or pages, and every request it might make is
 * refused: it is self-contained by rule, not only by request. Only the app
 * may frame it.
 */
export const PAGE_VIEW_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': [
    'sandbox allow-scripts allow-forms allow-modals',
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    'media-src data: blob:',
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'private, no-store',
};

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
