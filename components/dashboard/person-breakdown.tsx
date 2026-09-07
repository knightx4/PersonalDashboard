import { formatMoney, type CurrencyCode } from '@/lib/money';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { PERSON_DOT_CLASS, type Person } from '@/lib/people/load';
import type { PersonSpend } from '@/lib/dashboard/load';
import { cn } from '@/lib/cn';

/**
 * Who spent what.
 *
 * The whole point of sharing an account is being able to answer this without
 * toggling a filter twice and holding two numbers in your head. Same bar shape
 * as the merchant and category cards, so it reads as part of the set rather
 * than as a new kind of thing.
 *
 * Each bar is the person's own colour rather than one accent for all of them:
 * the colour is already how they are identified on every order row, and using
 * a different one here would make you learn a second mapping.
 */
export function PersonBreakdown({
  rows,
  people,
  currency,
}: {
  rows: PersonSpend[];
  people: Person[];
  currency: CurrencyCode;
}) {
  const byId = new Map(people.map((person) => [person.id, person]));
  const max = rows[0]?.netCents ?? 0;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>By person</CardTitle>
      </CardHeader>
      <CardBody className="pt-0">
        {rows.length === 0 ? (
          <p className="text-ui text-ink-muted">No orders in this period.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => {
              const person = row.personId ? byId.get(row.personId) : null;
              const width = max === 0 ? 0 : Math.round((row.netCents / max) * 100);
              return (
                <li key={row.personId ?? 'unattributed'}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-ui">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={cn(
                          'size-2 shrink-0 rounded-full',
                          person ? PERSON_DOT_CLASS[person.colour] : 'bg-border-strong',
                        )}
                        aria-hidden
                      />
                      <span className="truncate font-medium text-ink">
                        {/*
                          Named rather than hidden. Unattributed spending is
                          real spending, and leaving it out would make the
                          parts stop summing to the headline above.
                        */}
                        {person?.name ?? 'Not assigned'}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-ink">
                      {formatMoney(row.netCents, currency)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        person ? PERSON_DOT_CLASS[person.colour] : 'bg-border-strong',
                      )}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
