import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { sectionSubject } from '@/lib/core/section-path';
import {
  correctTotal,
  scoreLine,
  type ExternalCheck,
} from '@/lib/learn/external/model';
import { externalDate } from './external-view';
import { ItemForm } from './item-form';

function path(check: ExternalCheck) {
  return sectionSubject(
    '/learn/settings',
    'Learn settings',
    { label: 'External check', href: '/learn/settings/external' },
    { label: check.name, href: `/learn/settings/external/${check.id}` },
  );
}

/** The item being served: its question and the box, with nothing about how earlier ones went. */
export function ExternalItemView({ check, index }: { check: ExternalCheck; index: number }) {
  const total = check.items.length;
  const item = check.items[index];
  if (!item) return null;

  return (
    <PageColumn>
      <PageHeader subject={path(check)} title={check.name} />
      <div className="max-w-2xl">
        <div className={cn(cardVariants({ padding: 'standard' }), 'mt-6')}>
          <p className="text-small text-ink-muted">
            Question {index + 1} of {total}
          </p>
          <p className="mt-2 text-title font-medium text-ink">{item.question}</p>
          <ItemForm key={index} checkId={check.id} />
        </div>
      </div>
    </PageColumn>
  );
}

/**
 * The score, shown once the last item is answered, with the date it is kept
 * under. Each question follows with what was written and what the set gave,
 * so a low score can be read item by item.
 */
export function ExternalScoreView({ check }: { check: ExternalCheck }) {
  const total = check.items.length;
  const correct = check.correctCount ?? correctTotal(check.items);

  return (
    <PageColumn>
      <PageHeader subject={path(check)} title={check.name} />
      <div className="max-w-2xl">
        <div className={cn(cardVariants({ padding: 'standard' }), 'mt-6')}>
          <p className="text-small text-ink-muted">
            Scored {externalDate(check.scoredAt ?? check.createdAt)}
          </p>
          <p className="mt-1 text-figure font-medium tabular-nums text-ink">{scoreLine(correct, total)}</p>
          <p className="mt-1 text-ui text-ink-muted">
            Kept with this date. Your map is unchanged.
          </p>
        </div>

        <ul className={cn(cardVariants(), 'mt-6 divide-y divide-border overflow-hidden')}>
          {check.items.map((item, at) => (
            <li key={at} className="px-4 py-3">
              <p className="flex items-baseline gap-2 text-ui text-ink">
                <span className="min-w-0 flex-1">{item.question}</span>
                <span
                  className={cn(
                    'shrink-0 text-small',
                    item.correct ? 'text-ink' : 'text-ink-muted',
                  )}
                >
                  {item.correct ? 'Right' : item.response ? 'Not quite' : 'Passed'}
                </span>
              </p>
              <p className="mt-1 text-small text-ink-muted">You wrote: {item.response || 'Nothing'}</p>
              <p className="text-small text-ink-muted">The set says: {item.expected}</p>
            </li>
          ))}
        </ul>
      </div>
    </PageColumn>
  );
}
