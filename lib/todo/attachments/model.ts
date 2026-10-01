/**
 * What can be attached to a task or a calendar event, and what an attachment
 * is called on screen (supabase/migrations-todo/0016).
 *
 * Pure and client-safe: the upload control checks a file with the same rules
 * the server does, so a file the bucket would refuse is refused before the
 * upload starts rather than after it.
 */

export const ATTACHMENT_BUCKET = 'todo-attachments';

/** 25 MB, the bucket's own limit. */
export const MAX_ATTACHMENT_BYTES = 26_214_400;

/** The most attachments one task or event holds. A guard, not a design: nobody keeps two hundred. */
export const MAX_PER_TARGET = 100;

export const ATTACHMENT_ROLES = [
  'ticket',
  'receipt',
  'confirmation',
  'document',
  'photo',
  'other',
] as const;
export type AttachmentRole = (typeof ATTACHMENT_ROLES)[number];

export const ROLE_LABEL: Record<AttachmentRole, string> = {
  ticket: 'Ticket',
  receipt: 'Receipt',
  confirmation: 'Confirmation',
  document: 'Document',
  photo: 'Photo',
  other: 'Other',
};

export function isRole(value: unknown): value is AttachmentRole {
  return typeof value === 'string' && (ATTACHMENT_ROLES as readonly string[]).includes(value);
}

/**
 * The types the bucket accepts (the list in 0016). SVG and HTML are not on it
 * because a browser runs the script inside them.
 */
export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/calendar',
  'application/vnd.apple.pkpass',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'video/mp4',
  'video/quicktime',
]);

/** Types a browser gets wrong or leaves blank, by extension. */
const BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  txt: 'text/plain',
  csv: 'text/csv',
  ics: 'text/calendar',
  pkpass: 'application/vnd.apple.pkpass',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

/** The type to store: the browser's when it is on the list, else the file name's. */
export function resolveMimeType(name: string, declared: string | null | undefined): string | null {
  const type = (declared ?? '').split(';')[0].trim().toLowerCase();
  if (ALLOWED_MIME_TYPES.has(type)) return type;
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  const byName = extension ? BY_EXTENSION[extension] : undefined;
  return byName ?? null;
}

export type UploadCheck =
  | { ok: true; name: string; mimeType: string }
  | { ok: false; error: string };

/** A file name with the folders and control characters taken off, cut to a length the column takes. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const tidy = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (tidy.length <= 200) return tidy;
  const extension = /(\.[a-z0-9]{1,8})$/i.exec(tidy)?.[1] ?? '';
  return tidy.slice(0, 200 - extension.length) + extension;
}

/** Whether a file may be attached, with the sentence to show when it may not. */
export function checkUpload(file: {
  name: string;
  type?: string | null;
  size: number;
}): UploadCheck {
  const name = cleanFileName(file.name);
  if (!name) return { ok: false, error: 'That file has no name.' };
  if (file.size <= 0) return { ok: false, error: `${name} is empty.` };
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: `${name} is ${formatBytes(file.size)}; the most one attachment holds is ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
    };
  }
  const mimeType = resolveMimeType(name, file.type);
  if (!mimeType) {
    return {
      ok: false,
      error: `${name} is a kind of file that cannot be attached. Images, PDFs, documents, spreadsheets, audio and short video can.`,
    };
  }
  return { ok: true, name, mimeType };
}

/** Where a file lives in the bucket: the account's folder, then the attachment's own id. */
export function storagePathFor(userId: string, attachmentId: string): string {
  return `${userId}/${attachmentId}`;
}

/** A guess at what a file is for, from its name and type. The person can change it. */
export function guessRole(name: string, mimeType: string): AttachmentRole {
  const lower = name.toLowerCase();
  if (
    /\b(?:e-?tickets?|tickets?|boarding|admission|entry|pass)\b/.test(lower) ||
    lower.endsWith('.pkpass')
  )
    return 'ticket';
  if (/\b(?:receipt|invoice)\b/.test(lower)) return 'receipt';
  if (/\b(?:confirmation|booking|reservation|itinerary)\b/.test(lower)) return 'confirmation';
  if (mimeType.startsWith('image/')) return 'photo';
  return 'document';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function isImage(mimeType: string | null): boolean {
  return (
    !!mimeType &&
    mimeType.startsWith('image/') &&
    mimeType !== 'image/heic' &&
    mimeType !== 'image/heif'
  );
}

/** Images smaller than this inside an email are logos and tracking pixels, not something kept. */
export const MIN_EMAIL_IMAGE_BYTES = 15_000;

export type AttachmentTarget = { kind: 'task' | 'event'; id: string };

/** One attachment as a task or event shows it. */
export type AttachmentView = {
  id: string;
  kind: 'file' | 'email';
  role: AttachmentRole;
  name: string;
  note: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  /** The email a file came out of, so the list can show it under the message. */
  fromEmailId: string | null;
  emailFrom: string | null;
  emailSentAt: string | null;
  emailText: string | null;
  emailGmailUrl: string | null;
  createdAt: string;
};

/** Files that came out of an email go under it; the rest stand alone. Emails first, newest first. */
export function groupAttachments(
  items: readonly AttachmentView[],
): Array<{ item: AttachmentView; files: AttachmentView[] }> {
  const emailIds = new Set(items.filter((i) => i.kind === 'email').map((i) => i.id));
  const byEmail = new Map<string, AttachmentView[]>();
  const loose: AttachmentView[] = [];
  for (const item of items) {
    if (item.kind === 'file' && item.fromEmailId && emailIds.has(item.fromEmailId)) {
      byEmail.set(item.fromEmailId, [...(byEmail.get(item.fromEmailId) ?? []), item]);
    } else loose.push(item);
  }
  const newest = (a: AttachmentView, b: AttachmentView) => b.createdAt.localeCompare(a.createdAt);
  return loose
    .sort(newest)
    .map((item) => ({ item, files: (byEmail.get(item.id) ?? []).sort(newest) }));
}

const STOP = new Set([
  'the',
  'a',
  'an',
  'at',
  'in',
  'on',
  'of',
  'to',
  'for',
  'and',
  'with',
  'my',
  'our',
  'live',
]);

/** Words from a title worth searching a mailbox for: the event's own name, not its filler. */
export function searchWordsFor(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .slice(0, 4)
    .join(' ');
}
