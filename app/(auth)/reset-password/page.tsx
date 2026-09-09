'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { requestPasswordReset, type AuthState } from '../actions';

export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    requestPasswordReset,
    {},
  );

  return (
    <>
      <h1 className="font-display text-title tracking-tight text-ink">
        Reset your password
      </h1>
      <p className="mt-1 mb-5 text-body text-ink-muted">
        We will email you a link to set a new one.
      </p>

      <form action={formAction} className="space-y-3">
        <Field id="email" label="Email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
          />
        </Field>

        {state.error && (
          <p role="alert" className="text-ui text-danger">
            {state.error}
          </p>
        )}
        {/* Ink, not green: law 4 keeps positive for money coming back. */}
        {state.message && (
          <p role="status" className="text-ui text-ink-muted">
            {state.message}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? 'One moment…' : 'Send reset link'}
        </Button>
      </form>

      <p className="mt-5 text-center text-ui text-ink-muted">
        <Link href="/login" className="hover:text-ink">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
