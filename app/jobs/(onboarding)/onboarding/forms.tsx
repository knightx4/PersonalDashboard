'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/field';
import { finishOnboarding, saveCompanies, saveWelcome, type OnboardingState } from './actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'One moment…' : label}
    </Button>
  );
}

export function WelcomeForm({ defaultTimezone }: { defaultTimezone: string }) {
  const [state, action] = useActionState<OnboardingState, FormData>(saveWelcome, {});

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="displayName">Your name</Label>
          <Input id="displayName" name="displayName" />
        </div>
        <div>
          <Label htmlFor="timezone">Timezone</Label>
          <Input id="timezone" name="timezone" defaultValue={defaultTimezone} />
        </div>
        <div>
          <Label htmlFor="searchStartedOn">When did the search start</Label>
          <Input id="searchStartedOn" name="searchStartedOn" type="date" />
        </div>
      </div>

      <div>
        <Label htmlFor="targetTitles">Roles you are going for</Label>
        <Input
          id="targetTitles"
          name="targetTitles"
          placeholder="Strategic Finance Analyst, FP&A Manager"
        />
      </div>

      {state.error && (
        <p role="alert" className="text-[13px] text-status-rejected">
          {state.error}
        </p>
      )}

      <Submit label="Continue" />
    </form>
  );
}

export function CompaniesForm() {
  const [state, action] = useActionState<OnboardingState, FormData>(saveCompanies, {});

  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="companies">Companies you are pursuing</Label>
        <Textarea
          id="companies"
          name="companies"
          rows={6}
          placeholder={'Ramp, ramp.com\nLinear, linear.app\nFigma'}
        />
        <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
          One per line, name first, email domain after a comma if you know it. The domain is what
          lets a recruiter&rsquo;s personal work address find its company, and it is the list the
          direct-outreach inbox query searches.
        </p>
      </div>

      {state.error && (
        <p role="alert" className="text-[13px] text-status-rejected">
          {state.error}
        </p>
      )}

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
