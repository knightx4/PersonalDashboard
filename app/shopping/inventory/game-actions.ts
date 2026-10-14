'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { classifyScannedCode } from '@/lib/barcodes/scan-code';
import { buildOwnedGameRows } from '@/lib/games/create-owned-game';
import { resolveGameDetailed } from '@/lib/games/resolve';
import type { CanonicalGame, GameEditionCandidate } from '@/lib/games/types';
import { serverEnv } from '@/lib/env';
import { todayInTimezone } from '@/lib/money';

export type GameActionState = {
  error?: string;
  message?: string;
  game?: CanonicalGame | null;
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
      bggApiToken: env.BGG_API_TOKEN ?? null,
    };
  } catch {
    return {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
      upcApiKey: process.env.UPCITEMDB_API_KEY ?? null,
      bggApiToken: process.env.BGG_API_TOKEN ?? null,
    };
  }
}

const canonicalGameSchema = z.object({
  bggId: z.number().int().nullable(),
  wikidataId: z.string().nullable().optional().default(null),
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
  resolutionSource: z.enum(['bgg', 'wikidata', 'upc_lookup', 'manual']),
  alternates: z
    .array(
      z.object({
        bggId: z.number().int().nullable(),
        title: z.string(),
        yearPublished: z.number().int().nullable(),
        publisher: z.string().nullable(),
        imageUrl: z.string().nullable(),
        source: z.enum(['bgg', 'wikidata', 'upc_lookup', 'manual']),
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
    wikidata_id: bundle.gameDetails.wikidataId,
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

// latency: pending
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
    { upcApiKey: keys.upcApiKey, bggApiToken: keys.bggApiToken },
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

// latency: pending
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

  revalidatePath('/shopping/inventory');
  return { message: 'Added to your collection.', savedIds: [result.id], game };
}

/** Clear the confirm gate on a game already in the collection. */
// latency: pending
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

  revalidatePath('/shopping/inventory');
  revalidatePath(`/shopping/inventory/${item.id}`);
  return { message: 'Edition confirmed.' };
}

/** Swap a game onto one of the runner-up BGG entries. */
// latency: pending
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
        source: z.enum(['bgg', 'wikidata', 'upc_lookup', 'manual']),
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
      resolution_source: candidate.source === 'manual' ? 'manual' : candidate.source,
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

  revalidatePath('/shopping/inventory');
  revalidatePath(`/shopping/inventory/${item.id}`);
  return { message: `Switched to ${candidate.title}.` };
}

