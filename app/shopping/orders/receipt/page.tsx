import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/server';
import { ReceiptPhotoForm } from './receipt-form';

export const metadata = { title: 'Add receipt photo' };

export default async function ReceiptPhotoPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Receipt photo"
        description="Turn a paper receipt into an order and inventory units. Reuses the email extraction gate."
        actions={
          <Link href="/shopping/orders/new" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Manual order instead
          </Link>
        }
      />
      <ReceiptPhotoForm />
    </div>
  );
}
