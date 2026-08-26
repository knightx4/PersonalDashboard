/**
 * Board game resolution.
 *
 * Two ways in: a scanned barcode (UPC lookup names the product, BGG gives it
 * an identity) or a title from a photo or typing. Mirrors the book resolver
 * deliberately — same confidence, same "needs confirmation" contract, same
 * failure-vs-miss distinction.
 */
import { ProviderError, type ProviderFailure } from '@/lib/books/providers/http';
import {
  createBggProvider,
  type BggSearchHit,
  type BggThing,
} from '@/lib/games/providers/bgg';
import { cleanGameTitle, normalizeForCompare } from '@/lib/games/clean-title';
import { createUpcLookup } from '@/lib/products/providers/upc-lookup';
import { classifyScannedCode } from '@/lib/barcodes/scan-code';
import {
  isBarcodeInput,
  type CanonicalGame,
  type GameEditionCandidate,
  type ResolveGameInput,
} from '@/lib/games/types';

export type ResolveGameOptions = {
  fetch?: typeof globalThis.fetch;
  upcApiKey?: string | null;
  bggBaseUrl?: string;
  upcBaseUrl?: string;
};

export type ResolveGameOutcome = {
  game: CanonicalGame | null;
  failures: ProviderFailure[];
  /** What the barcode lookup called the product, before BGG cleanup. */
  productTitle?: string | null;
};

/** How many ranked search hits to keep, winner included. */
const DETAIL_FANOUT = 3;

function scoreTitle(query: string, hit: BggSearchHit | BggThing): number {
  const q = normalizeForCompare(query);
  const h = normalizeForCompare(hit.title);
  if (!q || !h) return 0;
  if (q === h) return 0.95;
  if (h.startsWith(q) || q.startsWith(h)) return 0.8;
  if (h.includes(q) || q.includes(h)) return 0.65;

  const qWords = new Set(q.split(' ').filter(Boolean));
  const hWords = h.split(' ').filter(Boolean);
  if (qWords.size === 0 || hWords.length === 0) return 0;
  const overlap = hWords.filter((w) => qWords.has(w)).length;
  return Math.min(0.6, (overlap / Math.max(qWords.size, hWords.length)) * 0.6);
}

function confirmationReasonFor(opts: {
  title: string;
  candidateCount: number;
  score: number;
  fromBarcode: boolean;
}): string | null {
  if (opts.candidateCount > 1) {
    return `${opts.candidateCount} BoardGameGeek entries match “${opts.title}”. Base games, expansions, and reprints price very differently — pick the box you own.`;
  }
  if (opts.score < 0.8) {
    return opts.fromBarcode
      ? `The barcode named a product we matched to “${opts.title}” at ${Math.round(opts.score * 100)}% confidence. Worth a glance before it drives a sell decision.`
      : `Closest title match scored ${Math.round(opts.score * 100)}%. Check the year and publisher against your box.`;
  }
  return null;
}

function thingToGame(
  thing: BggThing,
  opts: {
    barcode: string | null;
    confidence: number;
    needsConfirmation: boolean;
    alternates: GameEditionCandidate[];
    confirmationReason: string | null;
  },
): CanonicalGame {
  return {
    bggId: thing.bggId,
    barcode: opts.barcode,
    title: thing.title,
    yearPublished: thing.yearPublished,
    publisher: thing.publisher,
    minPlayers: thing.minPlayers,
    maxPlayers: thing.maxPlayers,
    playingTimeMinutes: thing.playingTimeMinutes,
    imageUrl: thing.imageUrl,
    matchConfidence: Number(opts.confidence.toFixed(3)),
    needsConfirmation: opts.needsConfirmation,
    resolutionSource: 'bgg',
    alternates: opts.alternates,
    confirmationReason: opts.confirmationReason,
  };
}

/**
 * Look a title up on BGG and rank the results. Detail fetches are limited to
 * the top few — BGG asks callers not to hammer it.
 */
async function resolveByTitle(
  rawTitle: string,
  options: ResolveGameOptions,
  failures: ProviderFailure[],
  context: { barcode: string | null; fromBarcode: boolean },
): Promise<CanonicalGame | null> {
  const title = cleanGameTitle(rawTitle);
  if (title.length < 2) return null;

  const bgg = createBggProvider({ fetch: options.fetch, baseUrl: options.bggBaseUrl });

  let hits: BggSearchHit[] = [];
  try {
    hits = await bgg.searchByTitle(title);
  } catch (error) {
    if (error instanceof ProviderError) {
      failures.push(error.failure);
      return null;
    }
    throw error;
  }
  if (hits.length === 0) return null;

  const ranked = hits
    .map((hit) => ({ hit, score: scoreTitle(title, hit) }))
    .sort((a, b) => b.score - a.score)
    .filter((entry) => entry.score >= 0.3);
  if (ranked.length === 0) return null;

  const top = ranked[0]!;

  // Only the winner earns a detail call. A shelf photo can hold forty games,
  // and BGG throttles hard — the runner-ups keep the search fields, which
  // already carry the id, title and year the confirm prompt needs.
  let thing: BggThing | null = null;
  try {
    thing = await bgg.thing(top.hit.bggId);
  } catch (error) {
    if (error instanceof ProviderError) failures.push(error.failure);
    else throw error;
  }

  const alternates: GameEditionCandidate[] = ranked
    .slice(1, DETAIL_FANOUT)
    .filter((entry) => entry.score >= 0.5)
    .map((entry) => ({
      bggId: entry.hit.bggId,
      title: entry.hit.title,
      yearPublished: entry.hit.yearPublished,
      publisher: null,
      imageUrl: null,
      source: 'bgg' as const,
    }));

  const plausible = 1 + alternates.length;
  const needsConfirmation = plausible > 1 || top.score < 0.8 || context.fromBarcode;
  const reason = needsConfirmation
    ? confirmationReasonFor({
        title: thing?.title ?? top.hit.title,
        candidateCount: plausible,
        score: top.score,
        fromBarcode: context.fromBarcode,
      })
    : null;

  // The detail call failing is not fatal: the search hit alone identifies the
  // game, it just arrives without publisher, player count, or box art.
  const resolved: BggThing = thing ?? {
    bggId: top.hit.bggId,
    title: top.hit.title,
    yearPublished: top.hit.yearPublished,
    publisher: null,
    minPlayers: null,
    maxPlayers: null,
    playingTimeMinutes: null,
    imageUrl: null,
  };

  return thingToGame(resolved, {
    barcode: context.barcode,
    confidence: top.score,
    needsConfirmation,
    alternates: needsConfirmation ? alternates : [],
    confirmationReason: reason,
  });
}

/** Resolve, reporting provider trouble separately from a genuine miss. */
export async function resolveGameDetailed(
  input: ResolveGameInput,
  options: ResolveGameOptions = {},
): Promise<ResolveGameOutcome> {
  const failures: ProviderFailure[] = [];

  if (isBarcodeInput(input)) {
    const code = classifyScannedCode(input.barcode);
    if (!code || code.kind !== 'product') {
      return { game: null, failures, productTitle: null };
    }

    const upc = createUpcLookup({
      fetch: options.fetch,
      apiKey: options.upcApiKey,
      baseUrl: options.upcBaseUrl,
    });

    let product = null;
    try {
      product = await upc.lookup(code.ean13);
    } catch (error) {
      if (error instanceof ProviderError) failures.push(error.failure);
      else throw error;
    }
    if (!product) return { game: null, failures, productTitle: null };

    const game = await resolveByTitle(product.title, options, failures, {
      barcode: code.ean13,
      fromBarcode: true,
    });
    return { game, failures, productTitle: product.title };
  }

  const game = await resolveByTitle(input.title, options, failures, {
    barcode: null,
    fromBarcode: false,
  });
  return { game, failures };
}

export async function resolveGame(
  input: ResolveGameInput,
  options: ResolveGameOptions = {},
): Promise<CanonicalGame | null> {
  const { game } = await resolveGameDetailed(input, options);
  return game;
}
