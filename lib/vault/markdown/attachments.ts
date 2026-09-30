/**
 * Which attachment an embed in a note means, and what the note page shows for
 * it (plan #1302).
 *
 * Every embed of a file arrives here as a markdown image: `![alt](src)`
 * written by hand, or `![[file.png|300]]` after toStandardMarkdown has
 * rewritten it into that form. So the renderer has one question to ask of
 * each image, and this answers it against the vault's attachment rows.
 *
 * Pure. Signing happens in the /vault/attachment route, on each request, so a
 * page left open for an hour still shows its images and nothing signed is ever
 * written into the page.
 */
import {
  attachmentMimeType,
  folderOf,
  isOverAttachmentLimit,
  type AttachmentMimeType,
} from '@/lib/vault/paths';

/** One row of obsidian.attachments, as the note page reads it. */
export type AttachmentEntry = {
  id: string;
  /** The vault path, subpath removed, as notes.path. */
  path: string;
  sizeBytes: number;
  mimeType: AttachmentMimeType;
  /** Null until the sync has copied it, and always null over 50 MB. */
  storagePath: string | null;
};

export type AttachmentKind = 'image' | 'pdf' | 'audio';

export type AttachmentView =
  | {
      state: 'ready';
      kind: AttachmentKind;
      name: string;
      href: string;
      /** From Obsidian's `|300` or `|300x200`; null draws it at its own size. */
      width: number | null;
      height: number | null;
    }
  /** Kept, not copied yet: the sync has listed it and will copy it. */
  | { state: 'waiting'; name: string }
  /** Over 50 MB, so listed and never copied. */
  | { state: 'too-large'; name: string }
  /** SVG, video, canvas and the rest: never kept, by the feature's brief. */
  | { state: 'not-kept'; name: string }
  /** No file by that name in the vault. */
  | { state: 'missing'; name: string };

export type AttachmentIndex = {
  /** Every row by its lowercased vault path. */
  byPath: Map<string, AttachmentEntry>;
  /** Every row by its lowercased filename; the shortest path wins, as for notes. */
  byName: Map<string, AttachmentEntry>;
};

export function buildAttachmentIndex(entries: AttachmentEntry[]): AttachmentIndex {
  const byPath = new Map<string, AttachmentEntry>();
  const byName = new Map<string, AttachmentEntry>();
  for (const entry of entries) {
    byPath.set(entry.path.toLowerCase(), entry);
    const name = fileNameOf(entry.path).toLowerCase();
    const existing = byName.get(name);
    if (!existing || entry.path.length < existing.path.length) byName.set(name, entry);
  }
  return { byPath, byName };
}

function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** `a/./b/../c` to `a/c`; null when it climbs out of the vault. */
function normalise(path: string): string | null {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (!out.length) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
}

/**
 * The src of a markdown image as a vault path, or null for anything that is
 * not one: a web address, a data URL, an empty link. Obsidian writes a
 * markdown embed with its spaces as `%20`, so the src is decoded first.
 */
function localTarget(src: string): string | null {
  const trimmed = src.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) return null;
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    // A stray % in a filename; the raw text is the better guess.
  }
  // A PDF embed can carry `#page=3`, which names a page, not a file.
  const hash = decoded.indexOf('#');
  return hash === -1 ? decoded : decoded.slice(0, hash);
}

/**
 * Resolve a link to a file the way Obsidian writes one, in its three link
 * formats: a vault path, a path relative to the note (`./`, `../`), or the
 * filename alone.
 */
export function resolveAttachment(
  target: string,
  notePath: string,
  index: AttachmentIndex,
): AttachmentEntry | null {
  const clean = target.replace(/^\/+/, '');
  if (!clean) return null;

  const relative = normalise(folderOf(notePath) ? `${folderOf(notePath)}/${clean}` : clean);
  if (relative !== null) {
    const hit = index.byPath.get(relative.toLowerCase());
    if (hit) return hit;
  }

  const absolute = normalise(clean);
  if (absolute !== null) {
    const hit = index.byPath.get(absolute.toLowerCase());
    if (hit) return hit;
  }

  return index.byName.get(fileNameOf(clean).toLowerCase()) ?? null;
}

function kindOf(mimeType: AttachmentMimeType): AttachmentKind {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'image';
}

/**
 * Obsidian's size syntax: the part of the alt text after the last `|`, either
 * a width or width x height. Anything else is ordinary alt text.
 */
export function readSize(alt: string): { alt: string; width: number | null; height: number | null } {
  const match = /^(.*)\|\s*(\d{1,5})(?:\s*x\s*(\d{1,5}))?\s*$/.exec(alt);
  if (!match) return { alt, width: null, height: null };
  return {
    alt: match[1].trim(),
    width: Number(match[2]) || null,
    height: match[3] ? Number(match[3]) || null : null,
  };
}

/**
 * What to show for one image in a note, or null when it is not a file in the
 * vault at all (a web address), which the renderer handles as before.
 */
export function viewAttachment(
  src: string,
  alt: string,
  notePath: string,
  index: AttachmentIndex,
  hrefFor: (entry: AttachmentEntry) => string,
): AttachmentView | null {
  const target = localTarget(src);
  if (target === null) return null;

  const name = fileNameOf(target) || target;
  const entry = resolveAttachment(target, notePath, index);

  if (!entry) {
    // A type the sync never keeps is not missing: it is in the vault and was
    // left out on purpose, and saying "missing" would send the person looking
    // for a file that is exactly where they left it.
    return attachmentMimeType(target) === null && /\.[a-z0-9]{1,8}$/i.test(target)
      ? { state: 'not-kept', name }
      : { state: 'missing', name };
  }

  const shown = fileNameOf(entry.path);
  if (entry.storagePath) {
    const { width, height } = readSize(alt);
    return { state: 'ready', kind: kindOf(entry.mimeType), name: shown, href: hrefFor(entry), width, height };
  }
  if (isOverAttachmentLimit(entry.sizeBytes)) return { state: 'too-large', name: shown };
  return { state: 'waiting', name: shown };
}

/** Where the page asks for an attachment; the route signs a link to it. */
export function attachmentHref(entry: Pick<AttachmentEntry, 'id'>): string {
  return `/vault/attachment/${entry.id}`;
}
