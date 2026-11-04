import { createHash } from 'node:crypto';

/**
 * Which projects' apps may file notes, and how each proves it is yours
 * (docs/PROJECT-NOTES.md).
 *
 * An app outside Dash has no Dash session, so it sends a token it was given
 * by Dash. Each entry names the table holding the sha-256 (hex) of every
 * token that project's app may use. The music studio already holds one, the
 * token "Open studio" mints for each computer (`studio_mint_key`, migration
 * 0288), so its notes need nothing new.
 *
 * To let another project's app file notes, give it a token table with a
 * `key_hash` column (or reuse one it has), add a line here, and mount the
 * note button in the app with the endpoint `projectNotesUrl` makes.
 */
export const PROJECT_NOTE_KEYS: Readonly<Record<string, { table: string }>> = {
  'music-pipeline': { table: 'studio_keys' },
};

export function noteKeyTable(projectId: string): string | null {
  return Object.hasOwn(PROJECT_NOTE_KEYS, projectId) ? PROJECT_NOTE_KEYS[projectId].table : null;
}

/** The hash a token is stored under. */
export function keyHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** The bearer token from an Authorization header, or null. */
export function bearerToken(header: string | null): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]{32,200})$/.exec(header?.trim() ?? '');
  return m ? m[1] : null;
}

/** Where a project's app sends its notes. */
export function projectNotesUrl(dashOrigin: string, projectId: string): string {
  return `${dashOrigin.replace(/\/+$/, '')}/api/projects/${encodeURIComponent(projectId)}/notes`;
}

/**
 * The origins allowed to call the endpoint from a browser: the project's own
 * site, and localhost while the app is being worked on. The token is what
 * authorises a call; this only decides which pages may read the answer.
 */
export function allowedOrigin(origin: string | null, projectUrl: string | null): string | null {
  if (!origin) return null;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  if (!projectUrl) return null;
  try {
    return new URL(projectUrl).origin === origin ? origin : null;
  } catch {
    return null;
  }
}
