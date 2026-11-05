/**
 * A bot's picture (plan #2955): the rules the form checks before an upload
 * and the server checks again before it saves the path. Nothing here reads
 * the database, so the form can use it in the browser.
 *
 * The picture is kept in the private you-bot-photos bucket
 * (migrations-you/0044) at <user id>/<advisor id>/<uuid>.<ext>, and
 * you.board_advisors.photo_path points at it.
 */

export const BOT_PHOTOS_BUCKET = 'you-bot-photos';

/** The bucket's own limit: 5 MB. */
export const BOT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** The types the bucket keeps, each with the extension its name takes. */
export const BOT_PHOTO_TYPES: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** What the file input offers. */
export const BOT_PHOTO_ACCEPT = Object.keys(BOT_PHOTO_TYPES).join(',');

/** Why a chosen file cannot be the picture, or null when it can. */
export function botPhotoProblem(file: { type: string; size: number }): string | null {
  if (!BOT_PHOTO_TYPES[file.type]) return 'Choose a PNG, JPEG, WebP or GIF image.';
  if (file.size <= 0) return 'That file is empty.';
  if (file.size > BOT_PHOTO_MAX_BYTES) return 'Choose an image under 5 MB.';
  return null;
}

/** Where a new picture of this bot goes, under a fresh name so no cache serves the old one. */
export function botPhotoPath(userId: string, advisorId: string, id: string, type: string): string {
  const ext = BOT_PHOTO_TYPES[type] ?? 'png';
  return `${userId}/${advisorId}/${id}.${ext}`;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FILE = new RegExp(`^${UUID}\\.(png|jpg|webp|gif)$`);

/** Whether a path is one botPhotoPath would make for this account and bot. */
export function isBotPhotoPath(path: string, userId: string, advisorId: string): boolean {
  const [user, advisor, file, ...rest] = path.split('/');
  return rest.length === 0 && user === userId && advisor === advisorId && FILE.test(file ?? '');
}
