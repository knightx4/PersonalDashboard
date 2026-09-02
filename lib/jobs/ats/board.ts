import 'server-only';

import * as greenhouse from './greenhouse';
import * as lever from './lever';
import * as ashby from './ashby';
import * as smartrecruiters from './smartrecruiters';
import * as workable from './workable';
import * as recruitee from './recruitee';
import * as breezy from './breezy';
import * as bamboohr from './bamboohr';
import * as rippling from './rippling';
import { type BoardVendor } from './detect';
import type { FetchedPosting } from './types';

/**
 * A whole board at a time.
 *
 * The insight the JD backfill rests on: for every vendor here the unit of work
 * is the *company*, not the posting. One call returns the board, so filling in
 * forty missing job descriptions at one employer costs one request rather than
 * forty — and the same request answers "is my posting still open" for free.
 *
 * Seven of the nine already fetched the board and threw all but one posting
 * away. This exposes what they were already doing.
 *
 * Two of them (SmartRecruiters, BambooHR) keep the description on a per-posting
 * endpoint, so their listings come back with an empty `text`. That is why
 * `hydrate` exists and why callers must go through it rather than reading
 * `posting.text` straight off a board listing.
 */

export { BOARD_VENDORS, isBoardVendor, type BoardVendor } from './detect';

/** Every published posting on one company's board. Throws if the board is not there. */
export async function fetchBoard(
  vendor: BoardVendor,
  boardToken: string,
): Promise<FetchedPosting[]> {
  switch (vendor) {
    case 'greenhouse':
      return greenhouse.fetchBoard(boardToken);
    case 'lever':
      return lever.fetchBoard(boardToken);
    case 'ashby':
      return ashby.fetchBoard(boardToken);
    case 'smartrecruiters':
      return smartrecruiters.fetchBoard(boardToken);
    case 'workable':
      return workable.fetchBoard(boardToken);
    case 'recruitee':
      return recruitee.fetchBoard(boardToken);
    case 'breezy':
      return breezy.fetchBoard(boardToken);
    case 'bamboohr':
      return bamboohr.fetchBoard(boardToken);
    case 'rippling':
      return rippling.fetchBoard(boardToken);
  }
}

/**
 * The description, fetched individually only when the board did not carry one.
 *
 * A no-op for the vendors that serve descriptions inline, which is what keeps
 * the common case at one request per company. It covers every vendor rather
 * than only the two known to need it, on purpose: these are undocumented
 * endpoints, and the flags that make them return descriptions in bulk are
 * exactly the sort of thing that quietly stops working. If that happens the
 * cost is one request per posting instead of an empty job description written
 * over a role and marked done.
 */
export async function hydrate(
  vendor: BoardVendor,
  boardToken: string,
  posting: FetchedPosting,
): Promise<FetchedPosting> {
  if (posting.text.trim() || !posting.atsJobId) return posting;

  const hydrated = await fetchOne(vendor, boardToken, posting.atsJobId);
  // Keep the listing's own fields where the detail call left a gap: the board
  // index sometimes carries a location the posting endpoint does not.
  return {
    ...hydrated,
    url: hydrated.url ?? posting.url,
    location: hydrated.location ?? posting.location,
    atsJobId: hydrated.atsJobId ?? posting.atsJobId,
  };
}

function fetchOne(
  vendor: BoardVendor,
  boardToken: string,
  jobId: string,
): Promise<FetchedPosting> {
  switch (vendor) {
    case 'greenhouse':
      return greenhouse.fetchPosting(boardToken, jobId);
    case 'lever':
      return lever.fetchPosting(boardToken, jobId);
    case 'ashby':
      return ashby.fetchPosting(boardToken, jobId);
    case 'smartrecruiters':
      return smartrecruiters.fetchPosting(boardToken, jobId);
    case 'workable':
      return workable.fetchPosting(boardToken, jobId);
    case 'recruitee':
      return recruitee.fetchPosting(boardToken, jobId);
    case 'breezy':
      return breezy.fetchPosting(boardToken, jobId);
    case 'bamboohr':
      return bamboohr.fetchPosting(boardToken, jobId);
    case 'rippling':
      return rippling.fetchPosting(boardToken, jobId);
  }
}
