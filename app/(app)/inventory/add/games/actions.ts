'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { classifyScannedCode } from '@/lib/barcodes/scan-code';
import { buildOwnedGameRows } from '@/lib/games/create-owned-game';
import { resolveGameDetailed } from '@/lib/games/resolve';
import { readGameShelfPhoto, type ShelfSighting } from '@/lib/games/shelf-photo';
import type { CanonicalGame, GameEditionCandidate } from '@/lib/games/types';
import { mapPool } from '@/lib/async/map-pool';
import { serverEnv } from '@/lib/env';
import { todayInTimezone } from '@/lib/money';

/** BGG asks callers to go easy; two at a time is polite and still quick. */
const RESOLVE_CONCURRENCY = 2;

export type ShelfRow = {
  /** What the photo (or barcode) said, kept for rows we could not resolve. */
  raw: string;
  sighting: ShelfSighting | null;
  game: CanonicalGame | null;
  error?: string;
};

export type GameActionState = {
  error?: string;
  message?: string;
  game?: CanonicalGame | null;
  rows?: ShelfRow[];
  /** Boxes the model could see but not identify. */
  unreadableCount?: number;
  notes?: string | null;
  savedIds?: string[];
  lookupFailed?: boolean;
  manualBarcode?: string | null;
};

function envKeys() {
  try {
    const env = serverEnv();
    return {
      anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
      upcApiKey: env.UPCITEMDB_API_KEY ?? null,
    };
  } catch {
    return {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
      upcApiKey: process.env.UPCITEMDB_API_KEY ?? null,
    };
  }
}

const canonicalGameSchema = z.object({
  bggId: z.number().int().nullable(),
  barcode: z.string().nullable(),
  title: z.string().min(1),
  yearPublished: z.number().int().nullable(),
  publisher: z.string().nullable(),
  minPlayers: z.number().int().nullable(),
  maxPlayers: z.number().int().nullable(),
  playingTimeMinutes: z.number().int().nullable(),
  imageUrl: z.string().nullable(),
  matchConfidence: z.number(),
  needsConfirmation: z.boolean(),
  resolutionSource: z.enum(['bgg', 'upc_lookup', 'manual']),
  alternates: z
    .array(
      z.object({
        bggId: z.number().int().nullable(),
        title: z.string(),
        yearPublished: z.number().int().nullable(),
        publisher: z.string().nullable(),
        imageUrl: z.string().nullable(),
        source: z.enum(['bgg', 'upc_lookup', 'manual']),
      }),
    )
    .optional()
    .default([]),
  confirmationReason: z.string().nullable().optional().default(null),
});

async function gamesCategoryId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const { data } = await supabase
    .from('categories')
    .select('id')
    .eq('slug', 'board-games')
    .is('user_id', null)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function userTimezone(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', userId)
    .single();
  return data?.timezone ?? 'UTC';
}

/** One insert path for every way a game gets added. */
async function persistGame(
  supabase: Awaited<ReturnType<typeof createClient>>,
  opts: {
    userId: string;
    categoryId: string;
    timezone: string;
    game: CanonicalGame;
    forceConfirmed?: boolean;
    autoImported?: boolean;
    source?: 'manual' | 'photo';
  },
): Promise<{ id: string } | { error: string }> {
  const bundle = buildOwnedGameRows({
    userId: opts.userId,
    gamesCategoryId: opts.categoryId,
    game: opts.game,
    acquiredAt: todayInTimezone(opts.timezone),
    source: opts.source ?? 'manual',
    forceConfirmed: opts.forceConfirmed,
    autoImported: opts.autoImported,
  });

  const { error: invError } = await supabase.from('inventory_items').insert({
    id: bundle.inventory.id,
    user_id: bundle.inventory.userId,
    order_item_id: null,
    category_id: bundle.inventory.categoryId,
    name: bundle.inventory.name,
    short_name: bundle.inventory.shortName,
    variant: bundle.inventory.variant,
    image_url: bundle.inventory.imageUrl,
    fingerprint_loose: bundle.inventory.fingerprintLoose,
    acquired_at: bundle.inventory.acquiredAt,
    cost_cents: bundle.inventory.costCents,
    search_tags: bundle.inventory.searchTags,
    source: bundle.inventory.source,
    status: bundle.inventory.status,
  });
  if (invError) return { error: invError.message };

  const { error: gameError } = await supabase.from('game_details').insert({
    id: bundle.gameDetails.id,
    inventory_item_id: bundle.gameDetails.inventoryItemId,
    bgg_id: bundle.gameDetails.bggId,
    barcode: bundle.gameDetails.barcode,
    year_published: bundle.gameDetails.yearPublished,
    publisher: bundle.gameDetails.publisher,
    min_players: bundle.gameDetails.minPlayers,
    max_players: bundle.gameDetails.maxPlayers,
    playing_time_minutes: bundle.gameDetails.playingTimeMinutes,
    condition: null,
    resolution_source: bundle.gameDetails.resolutionSource,
    match_confidence: bundle.gameDetails.matchConfidence,
    needs_confirmation: bundle.gameDetails.needsConfirmation,
    candidates: bundle.gameDetails.candidates,
    confirmation_reason: bundle.gameDetails.confirmationReason,
    auto_imported: bundle.gameDetails.autoImported,
  });
  if (gameError) {
    await supabase.from('inventory_items').delete().eq('id', bundle.inventory.id);
    return { error: gameError.message };
  }

  return { id: bundle.inventory.id };
}

export async function searchGame(
  _prev: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  await requireUser();
  const query = String(formData.get('query') ?? '').trim();
  if (!query) return { error: 'Enter a game name or scan a barcode.' };

  const keys = envKeys();
  const code = classifyScannedCode(query);

  // A Bookland barcode is a book — send the user to the right scanner.
  if (code?.kind === 'isbn') {
    return {
      error: 'That barcode is an ISBN (a book). Use Add books → Scan barcode for it.',
    };
  }

  const outcome = await resolveGameDetailed(
    code?.kind === 'product' ? { barcode: code.ean13 } : { title: query },
    { upcApiKey: keys.upcApiKey },
  );

  if (outcome.game) {
    return {
      game: outcome.game,
      message: outcome.productTitle
        ? `Barcode named “${outcome.productTitle}”.`
        : 'Match found.',
    };
  }

  if (outcome.failures.length > 0) {
    const rateLimited = outcome.failures.some((f) => f.kind === 'rate_limited');
    return {
      error: rateLimited
        ? 'BoardGameGeek or the barcode database is rate-limiting us. Try again shortly — this is not a verdict on your game.'
        : 'The game databases did not answer just now. Try again, or add it by hand.',
      lookupFailed: true,
      manualBarcode: code?.kind === 'product' ? code.ean13 : null,
    };
  }

  return {
    error:
      code?.kind === 'product'
        ? 'That barcode is not in the product database. Type the game name instead, or add it by hand.'
        : 'No BoardGameGeek match. Check the spelling, or add it by hand.',
    manualBarcode: code?.kind === 'product' ? code.ean13 : null,
  };
}

export async function saveGame(
  _prev: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const raw = String(formData.get('game_json') ?? '');
  if (!raw) return { error: 'Nothing to save.' };
  let game: CanonicalGame;
  try {
    const parsed = canonicalGameSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { error: 'Invalid game payload.' };
    game = parsed.data;
  } catch {
    return { error: 'Invalid game payload.' };
  }

  const categoryId = await gamesCategoryId(supabase);
  if (!categoryId) {
    return { error: 'Board games category is missing — run migration 0022.' };
  }

  const result = await persistGame(supabase, {
    userId: user.id,
    categoryId,
    timezone: await userTimezone(supabase, user.id),
    game,
    forceConfirmed: String(formData.get('force_confirmed') ?? '') === 'true',
  });
  if ('error' in result) return { error: result.error };

  revalidatePath('/inventory');
  return { message: 'Added to your collection.', savedIds: [result.id], game };
}

export async function saveManualGame(
  _prev: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const title = String(formData.get('title') ?? '').trim();
  if (!title) return { error: 'Title is required.' };

  const yearRaw = String(formData.get('year_published') ?? '').trim();
  const yearPublished = yearRaw ? Number(yearRaw) : null;
  if (
    yearPublished != null &&
    (!Number.isInteger(yearPublished) || yearPublished < 1000 || yearPublished > 2100)
  ) {
    return { error: 'Year must be a four-digit year.' };
  }

  const barcodeRaw = String(formData.get('barcode') ?? '').trim();
  const code = barcodeRaw ? classifyScannedCode(barcodeRaw) : null;

  const game: CanonicalGame = {
    bggId: null,
    barcode: code?.kind === 'product' ? code.ean13 : null,
    title,
    yearPublished,
    publisher: String(formData.get('publisher') ?? '').trim() || null,
    minPlayers: null,
    maxPlayers: null,
    playingTimeMinutes: null,
    imageUrl: null,
    matchConfidence: 1,
    needsConfirmation: false,
    resolutionSource: 'manual',
    alternates: [],
    confirmationReason: null,
  };

  const categoryId = await gamesCategoryId(supabase);
  if (!categoryId) {
    return { error: 'Board games category is missing — run migration 0022.' };
  }

  const result = await persistGame(supabase, {
    userId: user.id,
    categoryId,
    timezone: await userTimezone(supabase, user.id),
    game,
    forceConfirmed: true,
  });
  if ('error' in result) return { error: result.error };

  revalidatePath('/inventory');
  return { message: 'Added by hand.', savedIds: [result.id], game };
}

function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  return { mediaType: match[1]!, data: match[2]!.replace(/\s+/g, '') };
}

/**
 * Read a shelf photo and resolve everything it saw. Returns one row per
 * sighting — resolved, unsure, or unresolved — plus the count of boxes the
 * model could see but not identify, so the gap is visible rather than implied.
 */
export async function extractGamesFromPhoto(
  _prev: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  await requireUser();
  const keys = envKeys();
  if (!keys.anthropicApiKey) {
    return { error: 'Photo import needs ANTHROPIC_API_KEY on the server.' };
  }

  const parsedImage = parseDataUrl(String(formData.get('image_data_url') ?? ''));
  if (!parsedImage) return { error: 'Upload a JPEG or PNG photo.' };
  if (parsedImage.data.length > 5_500_000) {
    return { error: 'Photo is too large. Try a smaller image.' };
  }

  const reading = await readGameShelfPhoto({
    apiKey: keys.anthropicApiKey,
    mediaType: parsedImage.mediaType as 'image/jpeg' | 'image/png',
    base64Data: parsedImage.data,
  });
  if (!reading.ok) return { error: reading.error };

  const rows = await mapPool(
    reading.reading.games,
    RESOLVE_CONCURRENCY,
    async (sighting): Promise<ShelfRow> => {
      const query = [sighting.title, sighting.edition].filter(Boolean).join(': ');
      try {
        const outcome = await resolveGameDetailed(
          { title: query, publisher: sighting.publisher ?? null },
          { upcApiKey: keys.upcApiKey },
        );
        return {
          raw: query,
          sighting,
          game: outcome.game,
          error:
            !outcome.game && outcome.failures.length > 0
              ? 'Lookup unavailable — try this one again later.'
              : undefined,
        };
      } catch (error) {
        return {
          raw: query,
          sighting,
          game: null,
          error: error instanceof Error ? error.message : 'Lookup failed',
        };
      }
    },
  );

  const matched = rows.filter((r) => r.game).length;
  return {
    rows,
    unreadableCount: reading.reading.unreadable_boxes,
    notes: reading.reading.notes ?? null,
    message: `Read ${rows.length} box(es), matched ${matched}.${
      reading.reading.unreadable_boxes > 0
        ? ` ${reading.reading.unreadable_boxes} box(es) were not readable in this photo.`
        : ''
    }`,
  };
}

/** Save the rows the user ticked from a photo import. */
export async function saveGameBatch(
  _prev: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const raw = String(formData.get('games_json') ?? '');
  if (!raw) return { error: 'Nothing to save.' };

  let games: CanonicalGame[];
  try {
    const parsed = z.array(canonicalGameSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) return { error: 'Invalid game list.' };
    games = parsed.data;
  } catch {
    return { error: 'Invalid game list JSON.' };
  }

  const selected = new Set(
    formData
      .getAll('selected')
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n >= 0),
  );

  const categoryId = await gamesCategoryId(supabase);
  if (!categoryId) {
    return { error: 'Board games category is missing — run migration 0022.' };
  }
  const timezone = await userTimezone(supabase, user.id);

  const savedIds: string[] = [];
  for (let i = 0; i < games.length; i++) {
    if (!selected.has(i)) continue;
    const game = games[i]!;
    const result = await persistGame(supabase, {
      userId: user.id,
      categoryId,
      timezone,
      game,
      source: 'photo',
      autoImported: true,
    });
    if ('error' in result) return { error: result.error, savedIds };
    savedIds.push(result.id);
  }

  revalidatePath('/inventory');
  return {
    message: savedIds.length
      ? `Added ${savedIds.length} game(s) to your collection.`
      : 'No games selected.',
    savedIds,
  };
}

/** Clear the confirm gate on a game already in the collection. */
export async function confirmGameEdition(
  _prev: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const id = z.string().uuid().safeParse(formData.get('inventory_item_id'));
  if (!id.success) return { error: 'Missing item.' };

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!item) return { error: 'Item not found.' };

  const { error } = await supabase
    .from('game_details')
    .update({ needs_confirmation: false, candidates: [], confirmation_reason: null })
    .eq('inventory_item_id', item.id);
  if (error) return { error: error.message };

  revalidatePath('/inventory');
  revalidatePath(`/inventory/${item.id}`);
  return { message: 'Edition confirmed.' };
}

/** Swap a game onto one of the runner-up BGG entries. */
export async function switchGameEdition(
  _prev: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const id = z.string().uuid().safeParse(formData.get('inventory_item_id'));
  if (!id.success) return { error: 'Missing item.' };

  let candidate: GameEditionCandidate;
  try {
    const parsed = z
      .object({
        bggId: z.number().int().nullable(),
        title: z.string().min(1),
        yearPublished: z.number().int().nullable(),
        publisher: z.string().nullable(),
        imageUrl: z.string().nullable(),
        source: z.enum(['bgg', 'upc_lookup', 'manual']),
      })
      .safeParse(JSON.parse(String(formData.get('candidate_json') ?? '')));
    if (!parsed.success) return { error: 'Invalid edition payload.' };
    candidate = parsed.data;
  } catch {
    return { error: 'Invalid edition payload.' };
  }

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!item) return { error: 'Item not found.' };

  const { error: detailError } = await supabase
    .from('game_details')
    .update({
      bgg_id: candidate.bggId,
      year_published: candidate.yearPublished,
      publisher: candidate.publisher,
      resolution_source: 'bgg',
      match_confidence: 1,
      needs_confirmation: false,
      candidates: [],
      confirmation_reason: null,
    })
    .eq('inventory_item_id', item.id);
  if (detailError) return { error: detailError.message };

  const { error: invError } = await supabase
    .from('inventory_items')
    .update({
      name: candidate.title,
      ...(candidate.imageUrl ? { image_url: candidate.imageUrl } : {}),
    })
    .eq('id', item.id)
    .eq('user_id', user.id);
  if (invError) return { error: invError.message };

  revalidatePath('/inventory');
  revalidatePath(`/inventory/${item.id}`);
  return { message: `Switched to ${candidate.title}.` };
}

/**
 * Any other barcode: keep the product name and file it as plain inventory.
 * Not every scan is a book or a game, and a named row beats a dead end.
 */
export async function saveScannedProduct(
  _prev: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const title = String(formData.get('title') ?? '').trim();
  if (!title) return { error: 'Give the item a name.' };
  const barcodeRaw = String(formData.get('barcode') ?? '').trim();
  const code = barcodeRaw ? classifyScannedCode(barcodeRaw) : null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .single();

  const id = randomUUID();
  const { error } = await supabase.from('inventory_items').insert({
    id,
    user_id: user.id,
    order_item_id: null,
    category_id: null,
    name: title,
    short_name: title.slice(0, 60),
    variant: null,
    image_url: String(formData.get('image_url') ?? '').trim() || null,
    acquired_at: todayInTimezone(profile?.timezone ?? 'UTC'),
    cost_cents: 0,
    search_tags: code?.kind === 'product' ? [code.ean13] : [],
    source: 'manual',
    status: 'owned',
  });
  if (error) return { error: error.message };

  revalidatePath('/inventory');
  return { message: 'Added to inventory.', savedIds: [id] };
}
