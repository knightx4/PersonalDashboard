'use client';

import { BookDetailsPanel, type BookDetailsView } from '@/app/shopping/inventory/[id]/book-details-panel';
import { GameDetailsPanel, type GameDetailsView } from '@/app/shopping/inventory/[id]/game-details-panel';
import { ItemDetailsPanel } from '@/app/shopping/inventory/[id]/item-details-panel';

const categories = [
  { id: 'c1', name: 'Board games' },
  { id: 'c2', name: 'Books' },
];

/**
 * The catalogue part of an item's Details box, for a book whose printing is
 * still to confirm and a board game read from BoardGameGeek (plan #1950.3.4).
 * The book's "Neither one?" line used to send the reader to Add books; it now
 * opens capture's barcode scan. The game carries the BGG credit that sat at
 * the foot of the Add board games page.
 */
const book: BookDetailsView = {
  inventoryItemId: 'i-book',
  title: 'The Left Hand of Darkness',
  imageUrl: null,
  isbn13: '9780441478125',
  isbn10: null,
  authors: ['Ursula K. Le Guin'],
  edition: 'Ace mass-market paperback',
  publisher: 'Ace Books',
  publishedYear: 1987,
  condition: null,
  needsConfirmation: true,
  confirmationReason: 'Three printings share this title and author, and their resale prices differ.',
  candidates: [
    {
      isbn13: '9780441007318',
      isbn10: null,
      title: 'The Left Hand of Darkness',
      authors: ['Ursula K. Le Guin'],
      publisher: 'Ace Books',
      publishedYear: 2000,
      edition: '25th anniversary edition',
      coverUrl: null,
      source: 'google_books',
    },
    {
      isbn13: '9780575094185',
      isbn10: null,
      title: 'The Left Hand of Darkness',
      authors: ['Ursula K. Le Guin'],
      publisher: 'Gollancz',
      publishedYear: 2017,
      edition: 'SF Masterworks',
      coverUrl: null,
      source: 'open_library',
    },
  ],
  autoImported: false,
  matchConfidence: 0.58,
  resolutionSource: 'google_books',
};

const game: GameDetailsView = {
  inventoryItemId: 'i-game',
  title: 'Brass: Birmingham',
  imageUrl: null,
  bggId: 224517,
  yearPublished: 2018,
  publisher: 'Roxley',
  minPlayers: 2,
  maxPlayers: 4,
  playingTimeMinutes: 120,
  needsConfirmation: false,
  confirmationReason: null,
  candidates: [],
  autoImported: false,
  matchConfidence: 0.97,
  resolutionSource: 'bgg',
};

/** The item page's Details box as a book and as a game, each with its catalogue part. */
export function ShoppingItemCatalogueSurface() {
  return (
    <div className="space-y-8">
      <ItemDetailsPanel
        itemId="i-book"
        item={{ name: book.title, variant: null, notes: null }}
        categories={categories}
        categoryId="c2"
        categoryName="Books"
        template={[]}
        fields={[]}
        values={{}}
        searchAvailable
        catalog={<BookDetailsPanel book={book} />}
      />
      <ItemDetailsPanel
        itemId="i-game"
        item={{ name: game.title, variant: null, notes: 'Shelf C, second row.' }}
        categories={categories}
        categoryId="c1"
        categoryName="Board games"
        template={[]}
        fields={[]}
        values={{}}
        searchAvailable
        catalog={<GameDetailsPanel game={game} />}
      />
    </div>
  );
}
