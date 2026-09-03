'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { signIn, signInWithGoogle, signUp, type AuthState } from './actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'One moment…' : label}
    </Button>
  );
}

const field =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-body text-ink ' +
  'placeholder:text-ink-ghost transition-colors duration-150 ' +
  'focus:border-accent focus:outline-none';

export function AuthForm({ mode, next }: { mode: 'signin' | 'signup'; next?: string }) {
  const action = mode === 'signin' ? signIn : signUp;
  const [state, formAction] = useActionState<AuthState, FormData>(action, {});

  return (
    <div className="space-y-4">
      {/*
       * Google sign-in only: openid, email, profile. This is NOT the Gmail
       * read grant, which is a separate OAuth client asked for later during
       * onboarding with its own explanation screen.
       */}
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next ?? '/onboarding'} />
        <Button type="submit" variant="secondary" className="w-full">
          <svg className="size-4" viewBox="0 0 24 24" aria-hidden>
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.27-4.74 3.27-8.09Z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.62 0 3.07.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z"
            />
          </svg>
          Continue with Google
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-micro uppercase tracking-wider text-ink-muted">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="next" value={next ?? '/onboarding'} />

        <div>
          <label htmlFor="email" className="mb-1 block text-ui font-medium text-ink">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className={field}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-ui font-medium text-ink">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
            minLength={8}
            className={field}
            placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
          />
        </div>

        {state.error && (
          <p role="alert" className="text-ui text-danger">
            {state.error}
          </p>
        )}
        {state.message && (
          <p role="status" className="text-ui text-positive">
            {state.message}
          </p>
        )}

        <Submit label={mode === 'signin' ? 'Sign in' : 'Create account'} />
      </form>
    </div>
  );
}
