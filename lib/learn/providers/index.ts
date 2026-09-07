/**
 * The only way out of this module to the open web.
 *
 * Everything above this line -- resolution, location, the pages -- talks to
 * `fetchDocument` and knows nothing about how a document is retrieved or which
 * addresses are refused. That containment is the point: the guard against
 * fetching an internal address is worth nothing if a second call site can be
 * written next to it without one, so eslint forbids importing the
 * implementation from anywhere else and tests/lint-boundaries.test.ts proves
 * the rule fires.
 *
 * Same shape as lib/vault/providers/index.ts and for the same reason.
 */
export { fetchDocument } from './fetch';
export type { FetchedDocument, FetchFailure, FetchResult } from './fetch';
