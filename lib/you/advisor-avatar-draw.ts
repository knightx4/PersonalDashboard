import { createAvatar } from '@dicebear/core';
import { notionists } from '@dicebear/collection';
import {
  AVATAR_TRAITS,
  avatarFor,
  avatarSymbolId,
  type AdvisorAvatar,
  type AvatarLook,
} from './advisor-avatar';
import { listAvatars } from './board-advisors';
import { SEATS } from './board';
import type { YouSupabaseClient } from './db/schema-name';

/**
 * Drawing an advisor's avatar to SVG (plan #2581.3). Server code: the pages
 * draw every advisor once into a sprite of <symbol>s, and AdvisorAvatar
 * points at a symbol by id, so DiceBear never ships to the browser and a
 * page that shows one advisor forty times carries their drawing once.
 */

/**
 * The part of the 1744-square drawing that holds the head and shoulders:
 * Notionists draws down to the waist, which at 20 pixels leaves the face a
 * speck.
 */
export const AVATAR_VIEWBOX = '222 70 1300 1300';

/** createAvatar typed for options already checked by parseAvatar, which keeps only Notionists' own values. */
const create = createAvatar as (
  style: typeof notionists,
  options: Record<string, unknown>,
) => ReturnType<typeof createAvatar>;

function drawn(avatar: AdvisorAvatar) {
  return create(notionists, {
    seed: avatar.seed,
    clip: false,
    gestureProbability: 0,
    bodyIconProbability: 0,
    ...avatar.options,
  });
}

/** The drawing's inside, with its ids made unique to `prefix` so several can share one page. */
function inner(svg: string, prefix: string): string {
  return svg
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
    .replace(/<metadata[\s\S]*?<\/metadata>/, '')
    .replace(/id="([^"]+)"/g, `id="${prefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`);
}

/** One advisor's drawing as a standalone SVG, cropped to head and shoulders. */
export function avatarSvg(avatar: AdvisorAvatar, idPrefix = 'a'): string {
  const body = inner(drawn(avatar).toString(), idPrefix);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${AVATAR_VIEWBOX}" fill="none">${body}</svg>`;
}

/** The traits the drawing shows, including the ones DiceBear picked from the seed. */
export function avatarLook(avatar: AdvisorAvatar): AvatarLook {
  const extra = drawn(avatar).toJson().extra;
  const out = {} as AvatarLook;
  for (const trait of AVATAR_TRAITS) {
    const name = extra[trait];
    out[trait] = typeof name === 'string' ? name : null;
  }
  return out;
}

/** The advisors a page draws: each one's key and what is stored for them. */
export type AvatarEntry = { key: string; avatar?: unknown };

/**
 * Every advisor's drawing as one hidden SVG of symbols, for AdvisorAvatars
 * to put on the page. A key listed twice is drawn once.
 */
export function avatarSprite(entries: readonly AvatarEntry[]): string {
  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const { key, avatar } of entries) {
    if (seen.has(key)) continue;
    seen.add(key);
    const id = avatarSymbolId(key);
    const body = inner(drawn(avatarFor(key, avatar)).toString(), id);
    symbols.push(`<symbol id="${id}" viewBox="${AVATAR_VIEWBOX}">${body}</symbol>`);
  }
  return symbols.join('');
}

/** What AdvisorAvatars takes: the sprite and the keys it holds. */
export type AvatarSprite = { sprite: string; keys: string[] };

/** The sprite for these advisors, the five seats always among them so an older meeting's seat is drawn too. */
export function spriteFor(entries: readonly AvatarEntry[]): AvatarSprite {
  const all = [...entries, ...SEATS.map((key) => ({ key }))];
  const keys = [...new Set(all.map((e) => e.key))];
  return { sprite: avatarSprite(all), keys };
}

/** The person's advisors drawn for a page (plan #2581.3). */
export async function loadAvatarSprite(
  client: YouSupabaseClient,
  userId: string,
): Promise<AvatarSprite> {
  return spriteFor(await listAvatars(client, userId));
}
