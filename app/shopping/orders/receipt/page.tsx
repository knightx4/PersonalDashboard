import { requireUser } from '@/lib/auth/server';
import { ReceiptView } from './receipt-view';

export const metadata = { title: 'Add receipt photo' };

export default async function ReceiptPhotoPage() {
  await requireUser();
  return <ReceiptView />;
}
