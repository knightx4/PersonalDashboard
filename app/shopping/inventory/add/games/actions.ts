'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { classifyScannedCode } from '@/lib/barcodes/scan-code';
import { buildOwnedGameRows } from '@/lib/games/create-owned-game';
import { resolveGameDetailed } from '@/lib/games/resolve';
import { readGameShelfPhoto, type ShelfSighting } from '@/lib/games/shelf-photo';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import type { CanonicalGame, GameEditionCandidate } from '@/lib/games/types';
import { mapPool } from '@/lib/async/map-pool';
import type { ProviderFailure } from '@/lib/books/providers/http';
import { parseImageDataUrl } from '@/lib/images/data-url';
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

/** Turn provider trouble into something specific enough to act on. */
function describeFailures(failures: ProviderFailure[]): string | null {
  if (failures.length === 0) return null;
  const worst =
    failures.find((f) => f.kind === 'unauthorized') ??
    failures.find((f) => f.kind === 'rate_limited') ??
    failures.find((f) => f.kind === 'timeout') ??
    failures[0]!;
  const where = worst.provider === 'bgg' ? 'BoardGameGeek' : 'The barcode database';
  const status = worst.status ? ` (HTTP ${worst.status})` : '';
  switch (worst.kind) {
    case 'unauthorized':
      return `${where} refused the request${status} — it is blocking this server, not rejecting the game.`;
    case 'rate_limited':
      return `${where} is rate-limiting us${status}. Wait a minute and retry.`;
    case 'timeout':
      return `${where} did not answer in time. Retry.`;
    default:
      return `${where} was unavailable${status}.`;
  }
}

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

// latency: pending
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

  revalidatePath('/shopping/inventory');
  return { message: 'Added by hand.', savedIds: [result.id], game };
}

/**
 * Read a shelf photo and resolve everything it saw. Returns one row per
 * sighting — resolved, unsure, or unresolved — plus the count of boxes the
 * model could see but not identify, so the gap is visible rather than implied.
 */
// latency: pending
export async function extractGamesFromPhoto(
  prev: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  // A thrown server action reaches the browser as "an error occurred in the
  // Server Components render", which tells the user nothing. Everything below
  // returns a message instead.
  try {
    return await readShelfPhoto(formData);
  } catch (error) {
    console.error('shelf photo read failed', error);
    return {
      error:
        error instanceof Error
          ? `Photo read failed: ${error.message}`
          : 'Photo read failed on the server.',
    };
  }
}

async function readShelfPhoto(formData: FormData): Promise<GameActionState> {
  const user = await requireUser();
  const keys = envKeys();
  if (!keys.anthropicApiKey) {
    return { error: 'Photo import needs ANTHROPIC_API_KEY on the server.' };
  }

  const parsedImage = parseImageDataUrl(String(formData.get('image_data_url') ?? ''));
  if (!parsedImage.ok) return { error: parsedImage.error };

  const spend: SpendReport[] = [];
  const reading = await readGameShelfPhoto({
    apiKey: keys.anthropicApiKey,
    mediaType: parsedImage.mediaType,
    base64Data: parsedImage.data,
    onSpend: (report) => spend.push(report),
  });
  await recordSessionSpend(user.id, { module: 'shopping', operation: 'read-shelf-photo' }, spend);
  if (!reading.ok) return { error: reading.error };

  const sightings = reading.reading.games;
  const queryFor = (s: ShelfSighting) =>
    [s.title, s.edition].filter(Boolean).join(': ');

  // Three copies of Acquire on one shelf is one lookup, not three.
  const uniqueQueries = [...new Set(sightings.map(queryFor))];
  const allFailures: ProviderFailure[] = [];

  const resolved = new Map<string, CanonicalGame | null>();
  await mapPool(uniqueQueries, RESOLVE_CONCURRENCY, async (query) => {
    try {
      const outcome = await resolveGameDetailed(
        { title: query },
        { upcApiKey: keys.upcApiKey, bggApiToken: keys.bggApiToken },
      );
      allFailures.push(...outcome.failures);
      resolved.set(query, outcome.game);
    } catch (error) {
      console.error('game resolve failed', query, error);
      resolved.set(query, null);
    }
  });

  const failureNote = describeFailures(allFailures);

  const rows: ShelfRow[] = sightings.map((sighting) => {
    const query = queryFor(sighting);
    const game = resolved.get(query) ?? null;
    return {
      raw: query,
      sighting,
      game,
      error: !game && failureNote ? failureNote : undefined,
    };
  });

  const matched = rows.filter((r) => r.game).length;
  return {
    rows,
    unreadableCount: reading.reading.unreadable_boxes,
    notes: reading.reading.notes ?? null,
    lookupFailed: matched === 0 && allFailures.length > 0,
    message: `Read ${rows.length} box(es), matched ${matched}.${
      reading.reading.unreadable_boxes > 0
        ? ` ${reading.reading.unreadable_boxes} box(es) were not readable in this photo.`
        : ''
    }${failureNote ? ` ${failureNote}` : ''}`,
  };
}

/** Save the rows the user ticked from a photo import. */
// latency: pending
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

  revalidatePath('/shopping/inventory');
  return {
    message: savedIds.length
      ? `Added ${savedIds.length} game(s) to your collection.`
      : 'No games selected.',
    savedIds,
  };
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

/**
 * Any other barcode: keep the product name and file it as plain inventory.
 * Not every scan is a book or a game, and a named row beats a dead end.
 */
// latency: pending
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

  revalidatePath('/shopping/inventory');
  return { message: 'Added to inventory.', savedIds: [id] };
}


/**
 * Save boxes the photo read but no catalog confirmed.
 *
 * The photo is the evidence that the game is on the shelf; BoardGameGeek
 * being unreachable should not cost the user 40 correct titles. These land as
 * manual rows with no BGG id — searchable and sellable-by-hand, and a later
 * lookup can fill in the identity.
 */
// latency: pending
export async function saveUnmatchedGames(
  _prev: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const raw = String(formData.get('titles_json') ?? '');
  if (!raw) return { error: 'Nothing to save.' };

  let titles: string[];
  try {
    const parsed = z.array(z.string().trim().min(1)).safeParse(JSON.parse(raw));
    if (!parsed.success) return { error: 'Invalid title list.' };
    titles = parsed.data;
  } catch {
    return { error: 'Invalid title list JSON.' };
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
  for (let i = 0; i < titles.length; i++) {
    if (!selected.has(i)) continue;
    const title = titles[i]!;
    const result = await persistGame(supabase, {
      userId: user.id,
      categoryId,
      timezone,
      source: 'photo',
      autoImported: true,
      forceConfirmed: true,
      game: {
        bggId: null,
        barcode: null,
        title,
        yearPublished: null,
        publisher: null,
        minPlayers: null,
        maxPlayers: null,
        playingTimeMinutes: null,
        imageUrl: null,
        matchConfidence: 1,
        needsConfirmation: false,
        resolutionSource: 'manual',
        alternates: [],
        confirmationReason: null,
      },
    });
    if ('error' in result) return { error: result.error, savedIds };
    savedIds.push(result.id);
  }

  revalidatePath('/shopping/inventory');
  return {
    message: savedIds.length
      ? `Added ${savedIds.length} game(s) by name. Look them up later to attach a BGG id.`
      : 'No games selected.',
    savedIds,
  };
}
