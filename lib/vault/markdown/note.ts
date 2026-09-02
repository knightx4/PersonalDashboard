/**
 * Turning a markdown file into a note row.
 *
 * Two jobs: separate the frontmatter from the body, and work out what the note
 * is called. Both are boring and both are wrong in ways that show, so they are
 * here rather than inline in the sync.
 */
import matter from 'gray-matter';
import { basenameOf } from '@/lib/vault/paths';

export type ParsedNote = {
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
  /** The note's own idea of when it last changed, if it has one. */
  updatedAt: string | null;
};

/** Frontmatter keys people actually use for a modification date, in order. */
const UPDATED_KEYS = ['updated', 'modified', 'last-modified', 'lastmod', 'date'];
const CREATED_KEYS = ['created', 'date-created'];

/** Cap on what is stored. See the note on notes.body in the migration. */
export const MAX_NOTE_BYTES = 1_000_000;

export function noteTooLarge(sizeBytes: number): boolean {
  return sizeBytes > MAX_NOTE_BYTES;
}

function firstHeading(body: string): string | null {
  // Only an ATX h1, and only before any content. A `#` deeper in the document
  // is a section, not the note's name, and a `#tag` at the start of a line is
  // neither -- hence the required space.
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^#\s+(.+)$/.exec(trimmed);
    return match ? match[1].trim() : null;
  }
  return null;
}

function asDateString(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function pickDate(frontmatter: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = asDateString(frontmatter[key]);
    if (value) return value;
  }
  return null;
}

/**
 * Parse one note.
 *
 * Malformed frontmatter is not an error. A vault is a personal document store,
 * not a build input: half-typed YAML at the top of a file is a Tuesday, and
 * refusing to sync the note because of it would make the app less useful than
 * the folder it is mirroring. The delimiters are left in the body in that case,
 * so nothing is silently lost.
 */
export function parseNote(raw: string, vaultPath: string): ParsedNote {
  let frontmatter: Record<string, unknown> = {};
  let body = raw;

  try {
    const parsed = matter(raw);
    // gray-matter returns [] or a scalar for exotic documents; only an object
    // is a properties block.
    if (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) {
      frontmatter = parsed.data as Record<string, unknown>;
    }
    body = parsed.content;
  } catch {
    frontmatter = {};
    body = raw;
  }

  body = body.replace(/^\n+/, '');

  const declared = typeof frontmatter.title === 'string' ? frontmatter.title.trim() : '';

  return {
    // Obsidian's own convention is that the filename *is* the title, so it
    // wins over a heading: a note called "Rent" whose first line is "# Notes
    // from the call" is still Rent, and a list where half the rows are called
    // "Notes" is not a list.
    title: declared || basenameOf(vaultPath) || firstHeading(body) || 'Untitled',
    body,
    frontmatter,
    updatedAt: pickDate(frontmatter, UPDATED_KEYS) ?? pickDate(frontmatter, CREATED_KEYS),
  };
}
