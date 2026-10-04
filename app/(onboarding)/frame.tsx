import Link from 'next/link';
import { ModuleMark } from '@/components/ui/module-mark';
import { signOut } from '@/app/(auth)/actions';
import { Button, PRESS_AREA, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * Minimal chrome for first-run onboarding: no app nav until they finish.
 * Apart from the layout, which reads the session, so the surface gallery can
 * draw a step inside it.
 */
export function OnboardingFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-page">
      <header className="mx-auto flex h-14 max-w-lg items-center justify-between px-4 sm:px-0 sm:pt-6">
        <Link href="/onboarding" className={cn(PRESS_AREA, 'flex items-center gap-2')}>
          <ModuleMark module={null} size="md" />
          <span className="text-body font-semibold tracking-tight text-ink">
            Dash
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
