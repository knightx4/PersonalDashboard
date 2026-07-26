import Link from 'next/link';
import { AuthForm } from '../auth-form';

export const metadata = { title: 'Sign up' };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <>
      <h1 className="font-display text-lg font-semibold tracking-tight text-ink">
        Create your account
      </h1>
      <p className="mt-1 mb-5 text-sm text-ink-muted">
        You can connect an inbox later — or never.
      </p>

      <AuthForm mode="signup" next={next} />

      <p className="mt-5 text-center text-[13px] text-ink-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
