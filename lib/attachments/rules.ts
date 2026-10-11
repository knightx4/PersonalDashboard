/**
 * The one private store for files a person adds anywhere in the app (plan
 * #1712, feature #1711): what it accepts, where a file goes in it, and the
 * shape an uploaded file travels in from the browser to the server action
 * that records it. Shared by both sides, so it imports nothing from either.
 *
 * The bucket and core.attachments are made by
 * supabase/migrations/0193_core_attachments.sql, which enforces the same
 * limits again: the bucket refuses a type or a size outside them, and the
 * table refuses a sixth file on one row.
 */

/** The private bucket, one folder per account. */
export const ATTACHMENTS_BUCKET = 'attachments';

/** The bucket refuses anything larger. */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

/** The most files one row (a note, a todo, a question) holds. */
export const ATTACHMENTS_PER_ITEM = 5;

/** The types the feature settles, by extension. */
const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  csv: 'text/csv',
} as const;

export type AttachmentContentType = (typeof TYPES)[keyof typeof TYPES];

const CONTENT_TYPES = new Set<string>(Object.values(TYPES));

/** For a file input's `accept`. */
export const ATTACHMENT_ACCEPT = Object.keys(TYPES)
  .map((ext) => `.${ext}`)
  .join(',');

/** The line a picker shows under its button. */
export const ATTACHMENT_HINT = 'Images, PDFs, Word, text or CSV, up to 20 MB each.';

/**
 * The type a file is stored with, by its extension, or null when the store
 * does not take it. By extension rather than the browser's `file.type`,
 * which is empty for a CSV on some systems and says `application/vnd.ms-excel`
 * on others.
 */
export function attachmentContentType(name: string): AttachmentContentType | null {
  const dot = name.lastIndexOf('.');
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  return ext in TYPES ? TYPES[ext as keyof typeof TYPES] : null;
}

/** Whether a stored file is a picture, so it shows as a thumbnail rather than a chip. */
export function isImageAttachment(contentType: string): boolean {
  return contentType.startsWith('image/');
}

/**
 * Where a file is kept: your own folder, then a fresh id so two files with
 * the same name do not collide. The name keeps letters, digits, dots, dashes
 * and underscores, which storage accepts in any position; the name as chosen
 * is kept on the row.
 */
export function attachmentPath(userId: string, id: string, name: string): string {
  if (!userId) throw new Error('An attachment path needs a user id.');
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(-100);
  return `${userId}/${id}-${cleaned || 'file'}`;
}

/** Whether a path is one of yours in the shape attachmentPath makes. */
export function ownsAttachmentPath(userId: string, path: string): boolean {
  if (!userId || !path.startsWith(`${userId}/`)) return false;
  const rest = path.slice(userId.length + 1);
  return /^[0-9a-f-]{36}-[A-Za-z0-9._-]{1,100}$/.test(rest);
}

/**
 * A file the browser has put in the bucket and not yet recorded against a
 * row. The "Add a file" picker hands a list of these to its form, and the
 * server action passes them to recordAttachments once it has the row's id.
 */
export type UploadedAttachment = {
  path: string;
  name: string;
  contentType: AttachmentContentType;
  size: number;
};

/** Why a file cannot be added, or null when it can. */
export function attachmentProblem(file: { name: string; size: number }): string | null {
  if (!attachmentContentType(file.name)) {
    return `${file.name} cannot be added. Use an image, a PDF, a Word file, text or CSV.`;
  }
  if (file.size > ATTACHMENT_MAX_BYTES) return `${file.name} is over 20 MB.`;
  return null;
}

/**
 * The uploaded files a form sent, checked on the server: each in the
 * caller's own folder, of a type the store takes, within the size, no path
 * twice and five at most. Anything else is left out rather than trusted, so
 * a hand-made request cannot record a file in somebody else's folder. Takes
 * the hidden field's JSON as the picker writes it, or the parsed list.
 */
export function parseUploadedAttachments(input: unknown, userId: string): UploadedAttachment[] {
  let list: unknown = input;
  if (typeof input === 'string') {
    if (input.trim() === '') return [];
    try {
      list = JSON.parse(input);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];

  const seen = new Set<string>();
  const out: UploadedAttachment[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const { path, name, contentType, size } = item as Record<string, unknown>;
    if (typeof path !== 'string' || !ownsAttachmentPath(userId, path) || seen.has(path)) continue;
    if (typeof name !== 'string' || name.trim() === '' || name.length > 255) continue;
    if (typeof contentType !== 'string' || !CONTENT_TYPES.has(contentType)) continue;
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 0 || size > ATTACHMENT_MAX_BYTES) continue;
    seen.add(path);
    out.push({ path, name: name.trim(), contentType: contentType as AttachmentContentType, size });
    if (out.length === ATTACHMENTS_PER_ITEM) break;
  }
  return out;
}

/** Where one recorded file opens: the route signs a short link to it. */
export function attachmentHref(id: string): string {
  return `/attachments/${id}`;
}

/** A size as the chip shows it. */
export function attachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
