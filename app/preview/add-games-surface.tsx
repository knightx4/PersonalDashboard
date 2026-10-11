'use client';

import { AddGamesView } from '@/app/shopping/inventory/add/games/add-games-view';
import { GameCard } from '@/app/shopping/inventory/add/games/game-forms';
import type { CanonicalGame } from '@/lib/games/types';

const game: CanonicalGame = {
  bggId: 13,
  barcode: null,
  title: 'Catan: Seafarers and Cities & Knights Expansion Bundle, Anniversary Edition',
  yearPublished: 2015,
  publisher: 'Kosmos',
  minPlayers: 3,
  maxPlayers: 4,
  playingTimeMinutes: 90,
  imageUrl: null,
  matchConfidence: 0.62,
  needsConfirmation: true,
  resolutionSource: 'bgg',
  confirmationReason: 'More than one edition matches. Confirm before this drives a sell decision.',
  alternates: [
    {
      bggId: 270,
      title: 'Catan: Seafarers',
      yearPublished: 1997,
      publisher: 'Kosmos',
      imageUrl: null,
      source: 'bgg',
    },
    {
      bggId: 926,
      title: 'Catan 3D Collector’s Edition',
      yearPublished: 2010,
      publisher: null,
      imageUrl: null,
      source: 'bgg',
    },
  ],
};

/** The Add board games page on its Search tab, with an edition to pick. */
export function AddGamesSurface() {
  return (
    <AddGamesView mode="search">
      <GameCard game={game} onSave={() => {}} onPick={() => {}} pending={false} />
    </AddGamesView>
  );
}
