import { redirect } from 'next/navigation';

/** Kept so old links still work; the composer now lives on /shopping/saved. */
export default function NewSavedItemPage() {
  redirect('/shopping/saved');
}
