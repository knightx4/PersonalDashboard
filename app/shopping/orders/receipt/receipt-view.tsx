import Link from '@/components/ui/link';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { ReceiptPhotoForm } from './receipt-form';

/** The receipt photo page, apart from the sign-in check, so the gallery can draw it (plan #1604). */
export function ReceiptView() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Receipt photo"
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
