import { describe, expect, it } from 'vitest';
import { BOT_PHOTO_MAX_BYTES, botPhotoPath, botPhotoProblem, isBotPhotoPath } from '@/lib/you/bot-photos-model';

const USER = '11111111-1111-4111-8111-111111111111';
const BOT = '22222222-2222-4222-8222-222222222222';
const FILE = '33333333-3333-4333-8333-333333333333';

describe("a bot's picture (plan #2955)", () => {
  it('takes the four image types under 5 MB, and says why it refuses anything else', () => {
    expect(botPhotoProblem({ type: 'image/png', size: 1000 })).toBeNull();
    expect(botPhotoProblem({ type: 'image/jpeg', size: BOT_PHOTO_MAX_BYTES })).toBeNull();
    expect(botPhotoProblem({ type: 'image/svg+xml', size: 1000 })).toMatch(/PNG, JPEG, WebP or GIF/);
    expect(botPhotoProblem({ type: 'image/png', size: 0 })).toMatch(/empty/);
    expect(botPhotoProblem({ type: 'image/webp', size: BOT_PHOTO_MAX_BYTES + 1 })).toMatch(/5 MB/);
  });

  it("files a picture in the bot's own folder under a fresh name with the type's extension", () => {
    expect(botPhotoPath(USER, BOT, FILE, 'image/jpeg')).toBe(`${USER}/${BOT}/${FILE}.jpg`);
    expect(botPhotoPath(USER, BOT, FILE, 'image/gif')).toBe(`${USER}/${BOT}/${FILE}.gif`);
  });

  it('accepts only a path the upload would have made for this account and bot', () => {
    const path = botPhotoPath(USER, BOT, FILE, 'image/png');
    expect(isBotPhotoPath(path, USER, BOT)).toBe(true);
    expect(isBotPhotoPath(path, BOT, BOT)).toBe(false);
    expect(isBotPhotoPath(path, USER, USER)).toBe(false);
    expect(isBotPhotoPath(`${USER}/${BOT}/../${FILE}.png`, USER, BOT)).toBe(false);
    expect(isBotPhotoPath(`${USER}/${BOT}/${FILE}.svg`, USER, BOT)).toBe(false);
    expect(isBotPhotoPath(`${USER}/${BOT}/x/${FILE}.png`, USER, BOT)).toBe(false);
  });
});
