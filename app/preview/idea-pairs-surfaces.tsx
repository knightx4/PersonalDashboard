import { ReadingPageSkeleton } from '@/components/ui/skeleton';
import { IdeaPairView } from '@/app/learn/space/pairs/pair-view';
import { IdeaPairsView } from '@/app/learn/space/pairs/pairs-view';
import type { IdeaPair, PairIdea } from '@/lib/learn/map/idea-pairs';

/**
 * Fixtures for the same idea in two subjects (plan #2147.2): the four pairs
 * the person's ideas held when it was built, the finance ideas written once
 * as a sentence and once as an identifier, and one with a long claim.
 */

const SAAS = { id: 's-saas', name: 'SaaS and subscription business metrics' };
const FINANCE = { id: 's-finance', name: 'Startup Finance / FP&A' };
const MODELLING = { id: 's-model', name: 'Financial modeling in Excel for operators' };

function idea(id: string, rest: Omit<PairIdea, 'id'>): PairIdea {
  return { id, ...rest };
}

const MRR = idea('00000000-0000-4000-8000-000000000001', {
  name: 'MRR as a normalized run-rate, not cash collected',
  claim:
    'Monthly recurring revenue is the normalised monthly value of the subscriptions in force today. An annual plan paid up front adds a twelfth of its price, not the cash that came in.',
  subject: SAAS,
  state: 'known',
  established: 'tested',
  answers: 2,
  links: 1,
});
const MRR_FINANCE = idea('00000000-0000-4000-8000-000000000002', {
  name: 'mrr_arr_definition',
  claim: 'MRR and ARR are run-rates of contracted recurring revenue at a point in time; neither is cash collected nor recognised revenue.',
  subject: FINANCE,
  state: null,
  established: null,
  answers: 0,
  links: 3,
});
const CAC = idea('00000000-0000-4000-8000-000000000003', {
  name: 'CAC is a fully-loaded acquisition cost, not just ad spend',
  claim: 'Customer acquisition cost counts every cost of winning customers in the period, salaries and tools included, divided by the customers won.',
  subject: SAAS,
  state: null,
  established: null,
  answers: 0,
  links: 1,
});
const CAC_FINANCE = idea('00000000-0000-4000-8000-000000000004', {
  name: 'cac_fully_loaded',
  claim: 'Fully-loaded CAC includes sales and marketing headcount, tooling and overhead, not paid media alone.',
  subject: FINANCE,
  state: null,
  established: null,
  answers: 0,
  links: 2,
});
const ARR = idea('00000000-0000-4000-8000-000000000005', {
  name: 'ARR is MRR annualized, both are point-in-time stocks',
  claim: 'Annual recurring revenue is twelve times MRR. Both describe the book of subscriptions on one day, not a flow over a year.',
  subject: SAAS,
  state: 'known',
  established: 'tested',
  answers: 1,
  links: 2,
});
const CASH_FLOW = idea('00000000-0000-4000-8000-000000000006', {
  name: 'The cash flow statement is a derived reconciliation, not an independent statement',
  claim: 'The cash flow statement is built from the income statement and the change in the balance sheet, so it can be derived rather than entered.',
  subject: MODELLING,
  state: null,
  established: null,
  answers: 0,
  links: 0,
});
const THREE = idea('00000000-0000-4000-8000-000000000007', {
  name: 'three_statements_are_mechanically_linked',
  claim: 'The income statement, balance sheet and cash flow statement are linked by formulas: net income flows into retained earnings and the top of the cash flow.',
  subject: FINANCE,
  state: null,
  established: null,
  answers: 0,
  links: 0,
});

const PAIRS: IdeaPair[] = [
  { a: CAC_FINANCE, b: CAC, similarity: 0.942 },
  { a: MRR, b: MRR_FINANCE, similarity: 0.913 },
  { a: MRR_FINANCE, b: ARR, similarity: 0.878 },
  { a: THREE, b: CASH_FLOW, similarity: 0.866 },
];

export function IdeaPairsSurface() {
  return <IdeaPairsView pairs={PAIRS} />;
}

export function IdeaPairsEmptySurface() {
  return <IdeaPairsView pairs={[]} />;
}

export function IdeaPairsErrorSurface() {
  return <IdeaPairsView pairs={null} />;
}

export function IdeaPairsLoadingSurface() {
  return <ReadingPageSkeleton />;
}

/** The MRR pair: the tested idea is kept, and keeping both would carry Known across. */
export function IdeaPairSurface() {
  return <IdeaPairView pair={PAIRS[1]!} />;
}
