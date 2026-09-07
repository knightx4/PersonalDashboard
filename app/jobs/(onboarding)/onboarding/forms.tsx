'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, FieldError, Input, Label, Textarea } from '@/components/ui/field';
import { finishOnboarding, saveCompanies, saveWelcome, type OnboardingState } from './actions';
import { TimezoneField } from '@/components/ui/timezone-field';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" pending={pending}>
      {pending ? 'One moment…' : label}
    </Button>
  );
}

export function WelcomeForm() {
  const [state, action] = useActionState<OnboardingState, FormData>(saveWelcome, {});

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="displayName" label="Your name">
          <Input id="displayName" name="displayName" />
        </Field>
        <div>
          <Label htmlFor="timezone">Timezone</Label>
          {/* No default passed: the field reads this computer's zone itself,
              which is right far more often than any value the server could
              guess. */}
          <TimezoneField id="timezone" name="timezone" />
        </div>
        <Field id="searchStartedOn" label="When did the search start">
          <Input id="searchStartedOn" name="searchStartedOn" type="date" />
        </Field>
      </div>

      <Field id="targetTitles" label="Roles you are going for">
        <Input
          id="targetTitles"
          name="targetTitles"
          placeholder="Strategic Finance Analyst, FP&A Manager"
        />
      </Field>

      <FieldError>{state.error}</FieldError>

      <Submit label="Continue" />
    </form>
  );
}

export function CompaniesForm() {
  const [state, action] = useActionState<OnboardingState, FormData>(saveCompanies, {});

  return (
    <form action={action} className="space-y-4">
      <Field
        id="companies"
        label="Companies you are pursuing"
        hint="One per line, name first, email domain after a comma if you know it. The domain is what lets a recruiter’s personal work address find its company, and it is the list the direct-outreach inbox query searches."
        error={state.error}
      >
        <Textarea
          id="companies"
          name="companies"
          rows={6}
          placeholder={'Ramp, ramp.com\nLinear, linear.app\nFigma'}
        />
      </Field>

      <div className="flex gap-2">
        <Submit label="Continue" />
      </div>
    </form>
  );
}

export function FinishForm({ label = 'Go to the pipeline' }: { label?: string }) {
  return (
    <form action={finishOnboarding}>
      <Submit label={label} />
    </form>
  );
}

export function SkipForm() {
  return (
    <form action={finishOnboarding}>
      <Button type="submit" variant="secondary">
        Skip — I will add roles by hand
      </Button>
    </form>
  );
}
