import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/server';
import { SaveForm } from './save-form';

export const metadata = { title: 'Save something' };

export default async function NewSavedItemPage() {
  await requireUser();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Save something"
        description="Paste a product URL. We will pull what we can; you confirm before it lands in the queue."
        actions={
          <Link href="/saved" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Cancel
          </Link>
        }
      />
      <SaveForm />
    </div>
  );
}
