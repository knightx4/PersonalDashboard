'use client';

import { GameCard } from '@/app/shopping/inventory/add/games/game-forms';
import type { CanonicalGame } from '@/lib/games/types';

/**
 * The card a search comes back with when more than one edition matches, for
 * the gallery's Add board games surface (plan #1780). The buttons do nothing;
 * the real ones sit in GameSearchForm.
 */
const game: CanonicalGame = {
  bggId: 266192,
  barcode: null,
  title: 'Wingspan',
  yearPublished: 2019,
  publisher: 'Stonemaier Games',
  minPlayers: 1,
  maxPlayers: 5,
  playingTimeMinutes: 70,
  imageUrl: null,
  matchConfidence: 0.62,
  needsConfirmation: true,
  resolutionSource: 'bgg',
  confirmationReason: null,
  alternates: [
    {
      bggId: 300000,
      title: 'Wingspan: European Expansion',
      yearPublished: 2019,
      publisher: 'Stonemaier Games',
      imageUrl: null,
      source: 'bgg',
    },
    {
      bggId: 366161,
      title: 'Wingspan: Oceania Expansion',
      yearPublished: 2020,
      publisher: 'Stonemaier Games',
      imageUrl: null,
      source: 'bgg',
    },
  ],
};

export function GamesEditionPickerDemo() {
  return <GameCard game={game} onSave={() => {}} onPick={() => {}} pending={false} />;
}
