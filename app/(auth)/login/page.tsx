import Link from 'next/link';
import { Banner } from '@/components/ui/banner';
import { AuthForm } from '../auth-form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <>
      <h1 className="font-display text-title tracking-tight text-ink">
        Welcome back
      </h1>
      <p className="mt-1 mb-5 text-body text-ink-muted">Sign in to your dashboard.</p>

      {/* The shared banner, the same one the onboarding steps use two screens
          later. A failed sign-in is `warn` by the tone's own definition:
          something is wrong and only you can fix it. */}
      {error === 'oauth' && (
        <Banner tone="warn" className="mb-4">
          Google sign-in did not complete. Try again, or use your email and password.
        </Banner>
      )}

      <AuthForm mode="signin" next={next} />

      <p className="mt-5 text-center text-ui text-ink-muted">
        No account?{' '}
        <Link href="/signup" className="font-medium text-accent hover:underline">
          Sign up
        </Link>
      </p>
      <p className="mt-1.5 text-center text-ui text-ink-muted">
        <Link href="/reset-password" className="hover:text-ink">
          Forgot your password?
        </Link>
      </p>
    </>
  );
}
