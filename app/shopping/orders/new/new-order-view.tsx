import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Banner } from '@/components/ui/banner';
import type { Person } from '@/lib/people/load';
import type { OrderFormPrefill } from '@/lib/review/read-order';
import { OrderForm } from './order-form';

/**
 * Add an order, drawn from what the page read (page.tsx), so the gallery can
 * draw it from fixtures (plan #1604).
 */
export function NewOrderView({
  people,
  defaultPersonId,
  merchants,
  categories,
  defaultDate,
  prefill,
  sourceMessageId,
  readError,
}: {
  people: Person[];
  defaultPersonId: string | null;
  merchants: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  defaultDate: string;
  prefill: OrderFormPrefill | null;
  sourceMessageId: string | null;
  readError: string | null;
}) {
  return (
    // A form, but not a narrow one: each line item is a six-field row, and at
    // the single-form width those fields would be too tight to type into.
    <div className="mx-auto max-w-3xl max-sm:[&_input:not([type=checkbox]):not([type=radio])]:min-h-11 max-sm:[&_select]:min-h-11 max-sm:[&_select]:min-w-11">
      <PageHeader
        title="Add an order"
        description="Enter what you bought. Each unit lands in inventory with its share of tax, shipping and discount."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/shopping/orders/receipt"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              Receipt photo
            </Link>
            <Link href="/shopping/orders" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Cancel
            </Link>
          </div>
        }
      />
      {prefill && (
        <Banner tone="info" className="mb-6">
          {prefill.lines.length > 0
            ? `Filled in from the email, with ${prefill.lines.length} ${
                prefill.lines.length === 1 ? 'item' : 'items'
              }. Check it against the email before saving.`
            : 'Filled in from the email, which had no items that could be read. Add them before saving.'}{' '}
          Saving takes the email out of the review queue.
        </Banner>
      )}
      {readError && (
        <Banner tone="warn" className="mb-6">
          The email could not be read ({readError}), so the form is blank.
        </Banner>
      )}
      <OrderForm
        people={people}
        defaultPersonId={defaultPersonId}
        merchants={merchants}
        categories={categories}
        defaultDate={defaultDate}
        prefill={prefill}
        sourceMessageId={sourceMessageId}
      />
    </div>
  );
}
