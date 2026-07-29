'use client';

import { useActionState } from 'react';
import {
  completeOnboarding,
  continueToGmailConnect,
  type OnboardingState,
} from '@/app/(onboarding)/onboarding/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/field';

const initial: OnboardingState = {};

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function WelcomeForm() {
  const [state, dispatch, pending] = useActionState(continueToGmailConnect, initial);

  return (
    <form
      action={(formData) => {
        formData.set('timezone', browserTimezone());
        dispatch(formData);
      }}
      className="space-y-5"
    >
      <div>
        <Label htmlFor="display_name">What should we call you?</Label>
        <Input
          id="display_name"
          name="display_name"
          placeholder="Optional"
          autoComplete="nickname"
        />
      </div>
      <p className="text-[13px] text-ink-muted">
        “This month” and other date ranges use your local timezone.
      </p>
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Continuing…' : 'Continue'}
      </Button>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

export function SkipGmailForm() {
  const [state, dispatch, pending] = useActionState(completeOnboarding, initial);

  return (
    <form
      action={(formData) => {
        formData.set('timezone', browserTimezone());
        dispatch(formData);
      }}
    >
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Skipping…' : 'Skip for now — add orders by hand'}
      </Button>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

export function FinishOnboardingForm({
  label = 'Go to dashboard',
  next = '/dashboard',
}: {
  label?: string;
  next?: string;
}) {
  const [state, dispatch, pending] = useActionState(completeOnboarding, initial);

  return (
    <form action={dispatch}>
      <input type="hidden" name="next" value={next} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Finishing…' : label}
      </Button>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}
