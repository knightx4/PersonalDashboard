/**
 * Which files are notes or attachments, and where a note sits inside the
 * vault.
 *
 * The filters run against a listing, before a single byte of content is
 * requested, so a file that is neither a note nor an allowed attachment is
 * never fetched, never reaches the server and never reaches Postgres.
 * Filtering after a download would have been simpler and would have
 * transferred the whole vault to throw most of it away.
 *
 * Pure, and separate from the provider, because these rules are the interesting
 * part and testing them should not need a network.
 */

/** Extensions Obsidian treats as notes. Just the one, deliberately. */
const MARKDOWN = /\.md$/i;

/**
 * Directories whose contents are never notes.
 *
 * `.obsidian` is plugin and workspace configuration -- theme choices, window
 * layout, the list of enabled plugins. It is not something anybody wrote and
 * it changes on every app launch, so syncing it would mean a permanent stream
 * of meaningless updates. Every other dotfile directory is excluded on the
 * same principle: `.trash` is Obsidian's own deleted-notes folder, and `.git`
 * needs no explanation.
 */
function isHiddenPath(path: string): boolean {
  return path.split('/').some((segment) => segment.startsWith('.'));
}

/** True for a path this app will store as a note. */
export function isNotePath(path: string): boolean {
  if (!path || path.startsWith('/')) return false;
  if (isHiddenPath(path)) return false;
  return MARKDOWN.test(path);
}

/**
 * The attachment types the sync keeps, by extension, with the MIME type each
 * is stored under. The values are exactly the ones obsidian.attachments'
 * check constraint accepts (plan #1299), so a new type means changing both.
 * SVG is left out because it can carry script; video and `.canvas` are left
 * out by the feature's brief.
 */
const ATTACHMENT_TYPES: Record<string, AttachmentMimeType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

export type AttachmentMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'application/pdf'
  | 'audio/mpeg'
  | 'audio/mp4'
  | 'audio/wav'
  | 'audio/ogg';

/**
 * The largest attachment that is copied: 50 MB, the vault-attachments
 * bucket's own limit. A bigger file is still listed, so the note page can say
 * it is too large, but its bytes are never requested.
 */
export const ATTACHMENT_MAX_BYTES = 52_428_800;

/** The private bucket attachment copies are kept in (plan #1299). */
export const VAULT_ATTACHMENTS_BUCKET = 'vault-attachments';

/**
 * Where an attachment's copy is kept: by content, so a renamed file needs no
 * new copy and two paths holding the same file share one object.
 */
export function attachmentStoragePath(userId: string, connectionId: string, blobSha: string): string {
  return `${userId}/${connectionId}/${blobSha}`;
}

/** The MIME type a path is stored under, or null when it is not an attachment. */
export function attachmentMimeType(path: string): AttachmentMimeType | null {
  if (!path || path.startsWith('/')) return null;
  if (isHiddenPath(path)) return null;
  const file = path.slice(path.lastIndexOf('/') + 1);
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return null;
  return ATTACHMENT_TYPES[file.slice(dot + 1).toLowerCase()] ?? null;
}

/** True for a path this app keeps as an attachment. Hidden folders never are. */
export function isAttachmentPath(path: string): boolean {
  return attachmentMimeType(path) !== null;
}

/** True when an attachment is too large to copy and is shown as such instead. */
export function isOverAttachmentLimit(sizeBytes: number): boolean {
  return sizeBytes > ATTACHMENT_MAX_BYTES;
}

/**
 * Trim a connection's subpath to the form the database constraint expects:
 * no leading or trailing slash, and '' for "the whole repository".
 */
export function normaliseSubpath(subpath: string | null | undefined): string {
  return (subpath ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * A repository path as it should be stored, or null when it is outside the
 * vault.
 *
 * When the vault is a subdirectory, the stored path is relative to that
 * subdirectory -- otherwise every note in the app would be prefixed with a
 * folder that means nothing to the person who wrote it, and moving the vault
 * within its repo would rewrite every path.
 */
export function toVaultPath(repoPath: string, subpath: string): string | null {
  const root = normaliseSubpath(subpath);
  if (!root) return repoPath;
  if (repoPath === root) return null;
  if (!repoPath.startsWith(`${root}/`)) return null;
  return repoPath.slice(root.length + 1);
}

/** The repository path for a stored note path. The inverse of toVaultPath. */
export function toRepoPath(vaultPath: string, subpath: string): string {
  const root = normaliseSubpath(subpath);
  return root ? `${root}/${vaultPath}` : vaultPath;
}

/** The folder a note lives in, or '' for one at the vault root. */
export function folderOf(vaultPath: string): string {
  const cut = vaultPath.lastIndexOf('/');
  return cut === -1 ? '' : vaultPath.slice(0, cut);
}

/**
 * Where a stored note path is read in the app.
 *
 * Each segment is encoded on its own, so the slashes that make a vault path a
 * tree survive into the catch-all route while spaces, hashes and everything
 * else in an Obsidian filename do not break the link.
 */
export function noteHref(vaultPath: string): string {
  return `/vault/n/${vaultPath.split('/').map(encodeURIComponent).join('/')}`;
}

/** The filename without its extension -- Obsidian's own idea of a note's name. */
export function basenameOf(vaultPath: string): string {
  const file = vaultPath.slice(vaultPath.lastIndexOf('/') + 1);
  return file.replace(MARKDOWN, '');
}

/** Where a thread with Maya lives: the Maya tab's page for it (plan #1286). */
export function mayaThreadHref(threadId: string): string {
  return `/vault/maya/${threadId}`;
}
