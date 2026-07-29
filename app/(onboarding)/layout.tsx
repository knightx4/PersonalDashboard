import Link from 'next/link';
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
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto flex h-14 max-w-lg items-center justify-between px-4 sm:px-0 sm:pt-6">
        <Link href="/onboarding" className="flex items-center gap-2">
          <span
            className="size-6 rounded-md"
            style={{
              backgroundImage:
                'linear-gradient(135deg, var(--color-brand) 0%, var(--color-accent-pink) 100%)',
            }}
            aria-hidden
          />
          <span className="font-display text-[15px] font-semibold tracking-tight text-ink">
            Shopping Manager
          </span>
        </Link>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </header>
      <main className="mx-auto max-w-lg px-4 py-10 sm:px-0">{children}</main>
      <footer className="mx-auto max-w-lg px-4 pb-10 text-center text-[12px] text-ink-faint sm:px-0">
        <Link href="/privacy" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Privacy
        </Link>
      </footer>
    </div>
  );
}
