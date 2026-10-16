import { Button } from '@/components/ui/button';
import { SummaryView } from '@/app/learn/flow/summary-card';
import type { RunSummary } from '@/lib/learn/flow/summary';

/**
 * What a session moved (plan #2164.6), drawn from a fixture for the gallery:
 * two ideas shown with a line from each answer, one missed, two that came
 * onto the fringe. Today's piece draws the same card in its finished state.
 */

export const RUN_SUMMARY: RunSummary = {
  answers: 6,
  shown: [
    {
      name: 'A burn multiple above two is a warning sign',
      quote:
        'It is how much cash you burn for each new dollar of recurring revenue. Above two means growth is expensive.',
    },
    { name: 'Net revenue retention above 100% means expansion outruns churn', quote: 'Cohorts grow even with no new customers.' },
  ],
  missed: [
    {
      name: 'Payback period is measured on gross margin, not revenue',
      quote: 'Months until a customer has paid back what it cost to win them.',
      why: 'The definition holds, but it counts revenue where the idea counts gross margin.',
    },
  ],
  fringe: ['Magic number', 'Contribution margin by cohort'],
  more: { shown: 0, missed: 0, fringe: 0 },
};

export function FlowSummaryPreview() {
  return (
    <SummaryView
      summary={RUN_SUMMARY}
      foot={
        <Button type="button" size="lg">
          Keep going
        </Button>
      }
    />
  );
}
