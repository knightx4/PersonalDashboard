'use client';

import type { ProposeReport } from '@/lib/learn/catalogue/propose';
import {
  ProposalCard,
  ProposalLoading,
  ProposalNotice,
  ProposalResult,
} from '@/app/learn/s/[id]/pull-articles';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';

/**
 * Learn's "Find articles for this subject" (plan #2157.1) in the gallery: the
 * proposed list with a long title and a long idea name, and the parts a
 * person sees only after pressing: the lookup under way, every article
 * already held, and Wikipedia not answering. Nothing here calls an action.
 */

const REPORT: ProposeReport = {
  proposals: [
    { title: 'Marginal utility', idea: 'Marginal utility' },
    { title: 'Indifference curve', idea: 'Indifference curves' },
    { title: 'Price elasticity of demand', idea: 'Elasticity' },
    {
      title: 'Consumer choice under uncertainty and the expected utility hypothesis of von Neumann and Morgenstern',
      idea: 'Choosing between a sure thing and a gamble when the odds are known to you',
    },
    { title: 'Opportunity cost', idea: 'What you give up' },
  ],
  unmatched: 2,
  duplicates: 1,
  inCatalogue: 3,
  overLimit: 0,
  stopped: null,
};

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-7 gap-y-1">
        <AddTrigger label="Pull Wikipedia articles into the catalogue" onClick={() => {}} />
        <form className="-ml-2.5">
          <Button type="button" variant="ghost" size="sm">
            Find articles for this subject
          </Button>
        </form>
      </div>
      {children}
    </div>
  );
}

export function SubjectArticlesSurface() {
  return (
    <Row>
      <ProposalCard report={REPORT} />
    </Row>
  );
}

export function SubjectArticlesLoadingSurface() {
  return (
    <Row>
      <ProposalLoading ideaCount={14} />
    </Row>
  );
}

export function SubjectArticlesEmptySurface() {
  return (
    <Row>
      <ProposalResult report={{ ...REPORT, proposals: [], unmatched: 0, duplicates: 0, inCatalogue: 9 }} />
    </Row>
  );
}

export function SubjectArticlesErrorSurface() {
  return (
    <Row>
      <ProposalNotice tone="error">
        Wikipedia did not answer (fetch failed). Find again in a minute.
      </ProposalNotice>
    </Row>
  );
}
