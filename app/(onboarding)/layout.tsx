import Link from 'next/link';
import { ModuleMark } from '@/components/ui/module-mark';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/server';
import { signOut } from '@/app/(auth)/actions';
import { Button, buttonVariants } from '@/components/ui/button';

/**
 * Minimal chrome for first-run onboarding — no app nav until they finish.
 */
export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) redirect('/login?next=/onboarding');

  return (
    <div className="min-h-dvh bg-page">
      <header className="mx-auto flex h-14 max-w-lg items-center justify-between px-4 sm:px-0 sm:pt-6">
        <Link href="/onboarding" className="flex items-center gap-2">
          <ModuleMark module={null} size="md" />
          <span className="text-body font-semibold tracking-tight text-ink">
            Personal Dashboard
          </span>
        </Link>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </header>
      <main className="mx-auto max-w-lg px-4 py-10 sm:px-0">{children}</main>
      <footer className="mx-auto max-w-lg px-4 pb-10 text-center text-small text-ink-muted sm:px-0">
        <Link href="/privacy" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Privacy
        </Link>
      </footer>
    </div>
  );
}
