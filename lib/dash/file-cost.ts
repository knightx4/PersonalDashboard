import { costMicrosFor, EMPTY_USAGE } from '@/lib/core/spend/pricing';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';

/**
 * What reading the files sent with a question adds to the answer's cost
 * (plan #1716), for the $ hint beside Send. The ledger records an answer as
 * one figure, so this part is always a guess and the hint says uncertain.
 *
 * Tokens per file, by kind:
 * - a picture: about 1,600, since the model scales a large one down to that;
 * - a PDF: about 2,500 a page (its text and an image of the page), with the
 *   pages guessed at one per 100 KB, between 1 and 100;
 * - a text or CSV file: a token per four bytes, a Word file one per eight
 *   (it is zipped), up to the 25,000 a cut text holds (lib/dash/files.ts);
 * - an old .doc: none, since it is not read.
 *
 * The question with its files is sent again on each round of looking up. A
 * one-round answer pays for the files once; the usual three rounds pay once,
 * then a cache write, then a cache read; eight rounds add five more reads.
 */

const IMAGE_TOKENS = 1_600;
const PDF_PAGE_TOKENS = 2_500;
const PDF_BYTES_PER_PAGE = 100_000;
const PDF_PAGES_MAX = 100;
const TEXT_TOKENS_MAX = 25_000;

/** The tokens one file adds to the question, as guessed from its type and size. */
export function fileTokens(file: { contentType: string; size: number }): number {
  const { contentType, size } = file;
  if (contentType.startsWith('image/')) return IMAGE_TOKENS;
  if (contentType === 'application/pdf') {
    const pages = Math.min(PDF_PAGES_MAX, Math.max(1, Math.round(size / PDF_BYTES_PER_PAGE)));
    return pages * PDF_PAGE_TOKENS;
  }
  if (contentType === 'text/plain' || contentType === 'text/csv') {
    return Math.min(TEXT_TOKENS_MAX, Math.ceil(size / 4));
  }
  if (contentType.includes('wordprocessingml')) return Math.min(TEXT_TOKENS_MAX, Math.ceil(size / 8));
  return 0;
}

/** The added cost of reading these files on `model`, or null when there are none to read. */
export function filesEstimate(
  files: readonly { contentType: string; size: number }[],
  model: string,
): CostEstimate | null {
  const tokens = files.reduce((sum, file) => sum + fileTokens(file), 0);
  if (tokens === 0) return null;
  const price = (rounds: { cacheWrites: number; cacheReads: number }) =>
    costMicrosFor(model, {
      ...EMPTY_USAGE,
      inputTokens: tokens,
      cacheWriteTokens: tokens * rounds.cacheWrites,
      cachedInputTokens: tokens * rounds.cacheReads,
    }) ?? 0;
  return {
    lowMicros: price({ cacheWrites: 0, cacheReads: 0 }),
    medianMicros: price({ cacheWrites: 1, cacheReads: 1 }),
    highMicros: price({ cacheWrites: 1, cacheReads: 6 }),
    runs: 0,
    basis: 'guess',
    per: 'run',
    models: [model],
  };
}
