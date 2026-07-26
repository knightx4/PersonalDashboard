'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { requestPasswordReset, type AuthState } from '../actions';

export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    requestPasswordReset,
    {},
  );

  return (
    <>
      <h1 className="font-display text-lg font-semibold tracking-tight text-ink">
        Reset your password
      </h1>
      <p className="mt-1 mb-5 text-sm text-ink-muted">
        We will email you a link to set a new one.
      </p>

      <form action={formAction} className="space-y-3">
        <div>
          <label htmlFor="email" className="mb-1 block text-[13px] font-medium text-ink">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors duration-150 focus:border-brand focus:outline-none"
          />
        </div>

        {state.error && (
          <p role="alert" className="text-[13px] text-red-600">
            {state.error}
          </p>
        )}
        {state.message && (
          <p role="status" className="text-[13px] text-positive">
            {state.message}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? 'One moment…' : 'Send reset link'}
        </Button>
      </form>

      <p className="mt-5 text-center text-[13px] text-ink-muted">
        <Link href="/login" className="hover:text-ink">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
