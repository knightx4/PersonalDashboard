/**
 * Canonical board game record.
 *
 * Games repeat the books lesson: the printing matters. A "Catan" box could be
 * the 5th edition, a 2015 reprint, or the 3D special — different boxes, very
 * different resale. BoardGameGeek ids pin a version the way an ISBN pins an
 * edition, so an uncertain match gets confirmed rather than guessed.
 */

export type GameResolutionSource = 'bgg' | 'wikidata' | 'upc_lookup' | 'manual';

export type GameEditionCandidate = {
  bggId: number | null;
  title: string;
  yearPublished: number | null;
  publisher: string | null;
  imageUrl: string | null;
  source: GameResolutionSource;
};

export type CanonicalGame = {
  bggId: number | null;
  /** Set when Wikidata supplied the identity (BGG blocks datacenter IPs). */
  wikidataId?: string | null;
  /** EAN-13 form of the scanned barcode, when we came in that way. */
  barcode: string | null;
  title: string;
  yearPublished: number | null;
  publisher: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  playingTimeMinutes: number | null;
  imageUrl: string | null;
  matchConfidence: number;
  needsConfirmation: boolean;
  resolutionSource: GameResolutionSource;
  alternates?: GameEditionCandidate[];
  confirmationReason?: string | null;
};

export type ResolveGameInput =
  | { barcode: string }
  | { title: string; publisher?: string | null };

export function isBarcodeInput(
  input: ResolveGameInput,
): input is { barcode: string } {
  return 'barcode' in input && typeof input.barcode === 'string';
}
