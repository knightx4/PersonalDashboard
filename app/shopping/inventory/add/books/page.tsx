import { requireUser } from '@/lib/auth/server';
import { AddBooksView, type BookMode } from './books-view';

export const metadata = { title: 'Add owned books' };

function parseMode(raw: string | string[] | undefined): BookMode {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'paste' || value === 'scan' || value === 'photo' || value === 'manual') {
    return value;
  }
  return 'search';
}

export default async function AddOwnedBooksPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  return <AddBooksView mode={parseMode(params.mode)} />;
}
