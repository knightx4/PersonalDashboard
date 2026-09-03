import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export const metadata = { title: 'Sign-in failed' };

export default function AuthCodeErrorPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <h1 className="font-display text-title tracking-tight text-ink">
        That sign-in link did not work
      </h1>
      <p className="mt-1.5 max-w-sm text-body text-ink-muted">
        It may have expired or already been used. Request a new one and try again.
      </p>
      <Link href="/login" className={`${buttonVariants()} mt-5`}>
        Back to sign in
      </Link>
    </div>
  );
}
