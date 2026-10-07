import { notFound } from 'next/navigation';
import { createVaultClient } from '@/lib/vault/auth/server';
import { loadThemeMap } from '@/lib/vault/map/read';
import { ThemeView } from './theme-view';

export const dynamic = 'force-dynamic';

/**
 * One theme: the positions under it, each with every sentence behind it and
 * the note that sentence is in (#758).
 *
 * The note link carries a text fragment (lib/vault/map/fragment.ts), so
 * opening it scrolls to the sentence and highlights it. That is the second tap
 * of the two the step promises; the first was the theme on the map's list.
 *
 * The notes under the theme come after the positions, because a note can be
 * about a subject without arguing anything in it, and such a note would
 * otherwise not appear on this page at all.
 */
export default async function ThemePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createVaultClient();
  const map = await loadThemeMap(supabase, id);
  if (!map) notFound();

  return <ThemeView map={map} />;
}
