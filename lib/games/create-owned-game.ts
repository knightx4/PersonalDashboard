/**
 * Persist a resolved game as a standalone inventory unit + game_details row.
 * Pure builder: no database, mirroring lib/books/create-owned-book.ts.
 */
import { randomUUID } from 'node:crypto';
import { fingerprintLoose } from '@/lib/fingerprint';
import { enrichItemDisplay } from '@/lib/inventory/enrich-display';
import type { CanonicalGame, GameEditionCandidate } from '@/lib/games/types';

export type OwnedGameSource = 'manual' | 'photo' | 'receipt_photo' | 'email';

export type OwnedGameBundle = {
  inventory: {
    id: string;
    userId: string;
    categoryId: string;
    name: string;
    shortName: string;
    variant: string | null;
    imageUrl: string | null;
    fingerprintLoose: string;
    acquiredAt: string;
    costCents: number;
    searchTags: string[];
    source: OwnedGameSource;
    status: 'owned';
  };
  gameDetails: {
    id: string;
    inventoryItemId: string;
    bggId: number | null;
    wikidataId: string | null;
    barcode: string | null;
    yearPublished: number | null;
    publisher: string | null;
    minPlayers: number | null;
    maxPlayers: number | null;
    playingTimeMinutes: number | null;
    resolutionSource: CanonicalGame['resolutionSource'];
    matchConfidence: number;
    needsConfirmation: boolean;
    candidates: GameEditionCandidate[];
    confirmationReason: string | null;
    autoImported: boolean;
  };
};

export function buildOwnedGameRows(input: {
  userId: string;
  gamesCategoryId: string;
  game: CanonicalGame;
  acquiredAt: string;
  source?: OwnedGameSource;
  forceConfirmed?: boolean;
  autoImported?: boolean;
}): OwnedGameBundle {
  const inventoryId = randomUUID();
  const playersLabel =
    input.game.minPlayers && input.game.maxPlayers
      ? `${input.game.minPlayers}–${input.game.maxPlayers} players`
      : null;

  const enriched = enrichItemDisplay({
    name: input.game.title,
    variant: playersLabel,
    categorySlug: 'board-games',
    categoryName: 'Board games',
    searchTags: [
      'game',
      'games',
      'board game',
      ...(input.game.publisher ? [input.game.publisher.toLowerCase()] : []),
      ...(input.game.barcode ? [input.game.barcode] : []),
    ],
  });

  const needsConfirmation = input.forceConfirmed
    ? false
    : input.game.needsConfirmation;

  return {
    inventory: {
      id: inventoryId,
      userId: input.userId,
      categoryId: input.gamesCategoryId,
      name: input.game.title,
      shortName: enriched.shortName,
      variant: playersLabel,
      imageUrl: input.game.imageUrl,
      // BGG id when we have one: two copies of the same box should collide.
      fingerprintLoose: fingerprintLoose(
        input.game.bggId
          ? `bgg-${input.game.bggId}`
          : (input.game.wikidataId ?? input.game.title),
      ),
      acquiredAt: input.acquiredAt,
      costCents: 0,
      searchTags: enriched.searchTags,
      source: input.source ?? 'manual',
      status: 'owned',
    },
    gameDetails: {
      id: randomUUID(),
      inventoryItemId: inventoryId,
      bggId: input.game.bggId,
      wikidataId: input.game.wikidataId ?? null,
      barcode: input.game.barcode,
      yearPublished: input.game.yearPublished,
      publisher: input.game.publisher,
      minPlayers: input.game.minPlayers,
      maxPlayers: input.game.maxPlayers,
      playingTimeMinutes: input.game.playingTimeMinutes,
      resolutionSource: input.game.resolutionSource,
      matchConfidence: input.game.matchConfidence,
      needsConfirmation,
      candidates: needsConfirmation ? (input.game.alternates ?? []) : [],
      confirmationReason: needsConfirmation
        ? (input.game.confirmationReason ?? null)
        : null,
      autoImported: input.autoImported ?? false,
    },
  };
}
