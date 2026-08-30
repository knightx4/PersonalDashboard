import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { todayInTimezone } from '@/lib/money';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { createCoreClient } from '@/lib/core/auth/server';
import { defaultPerson, loadPeople } from '@/lib/people/load';
import { OrderForm } from './order-form';

export const metadata = { title: 'Add an order' };

export default async function NewOrderPage() {
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

  return (
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
      <OrderForm
      people={people}
      defaultPersonId={defaultPerson(people)?.id ?? null}
        merchants={merchants ?? []}
        categories={categories ?? []}
        defaultDate={defaultDate}
      />
    </div>
  );
}
