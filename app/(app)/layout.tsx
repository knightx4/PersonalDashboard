import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { TopNav } from '@/components/shell/top-nav';

/**
 * Shell for every signed-in section.
 *
 * Middleware already blocks unauthenticated requests to this group; the check
 * here is a second line, not the first, and it also gives us the profile.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();

  const [{ data: profile }, { count: reviewCount }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).single(),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('needs_review', true),
  ]);

  return (
    <div className="min-h-full">
      <TopNav
        displayName={profile?.display_name ?? null}
        email={user.email ?? ''}
        reviewCount={reviewCount ?? 0}
      />
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
