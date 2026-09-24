import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { todayInTimezone } from '@/lib/money';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { createCoreClient } from '@/lib/core/auth/server';
import { defaultPerson, loadPeople } from '@/lib/people/load';
import { prefillFromDraft, type OrderFormPrefill } from '@/lib/review/read-order';
import { loadReadOrderContext, readOrderFromMessage } from '@/lib/review/read-order-server';
import { Banner } from '@/components/ui/banner';
import { OrderForm } from './order-form';

export const metadata = { title: 'Add an order' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ from_email?: string }>;
}) {
  const { from_email: fromEmail } = await searchParams;
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: merchants }, { data: categories }, { data: profile }] = await Promise.all([
    supabase.from('merchants').select('id, name').order('name'),
    supabase
      .from('categories')
      .select('id, name')
      .is('parent_id', null)
      .order('name'),
    supabase.from('profiles').select('timezone').eq('id', user.id).single(),
  ]);

  const core = await createCoreClient();
  const people = await loadPeople(core, user.id);

  const defaultDate = todayInTimezone(profile?.timezone ?? 'UTC');

  // Reached from a waiting confirmation, shipping or delivery email: read it
  // again and open the form with what it holds. Nothing is saved until the
  // form is.
  let prefill: OrderFormPrefill | null = null;
  let sourceMessageId: string | null = null;
  let readError: string | null = null;
  if (fromEmail && UUID.test(fromEmail)) {
    const context = await loadReadOrderContext(supabase, user.id);
    const outcome = await readOrderFromMessage(supabase, core, context, fromEmail);
    if (outcome.ok) {
      prefill = prefillFromDraft(outcome.draft, {
        merchantIds: new Set((merchants ?? []).map((m) => m.id)),
        categoryIds: new Set((categories ?? []).map((c) => c.id)),
      });
      sourceMessageId = outcome.messageId;
    } else {
      readError = outcome.error;
    }
  }

  return (
    // A form, but not a narrow one: each line item is a six-field row, and at
    // the single-form width those fields would be too tight to type into.
    <div className="mx-auto max-w-3xl">
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
        defaultPersonId={defaultPerson(people)?.id ?? null}
        merchants={merchants ?? []}
        categories={categories ?? []}
        defaultDate={defaultDate}
        prefill={prefill}
        sourceMessageId={sourceMessageId}
      />
    </div>
  );
}
