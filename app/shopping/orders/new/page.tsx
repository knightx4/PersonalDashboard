import { createClient, requireUser } from '@/lib/auth/server';
import { todayInTimezone } from '@/lib/money';
import { createCoreClient } from '@/lib/core/auth/server';
import { defaultPerson, loadPeople } from '@/lib/people/load';
import { prefillFromDraft, type OrderFormPrefill } from '@/lib/review/read-order';
import { loadReadOrderContext, readOrderFromMessage } from '@/lib/review/read-order-server';
import { NewOrderView } from './new-order-view';

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
    <NewOrderView
      people={people}
      defaultPersonId={defaultPerson(people)?.id ?? null}
      merchants={merchants ?? []}
      categories={categories ?? []}
      defaultDate={defaultDate}
      prefill={prefill}
      sourceMessageId={sourceMessageId}
      readError={readError}
    />
  );
}
