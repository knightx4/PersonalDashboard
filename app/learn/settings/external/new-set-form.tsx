'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/field';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { startExternalCheck, type SitState } from './actions';

/**
 * Paste a set to sit. One item per line, the question and its answer split by
 * a tab or " | ". Pressing Start keeps the set and opens its first question.
 */
export function NewSetForm({ first = false }: { first?: boolean }) {
  const [state, start, pending] = useActionState<SitState, FormData>(startExternalCheck, {});

  return (
    <form action={start} className={cn(cardVariants({ padding: 'standard' }), 'mt-6')}>
      <h2 className="text-ui font-medium text-ink">{first ? 'Sit a set' : 'Sit another set'}</h2>
      <p className="mt-1 text-small text-ink-muted">
        Paste published questions that neither you nor Dash wrote. Each is served once, answers are
        marked as you go, and the score appears after the last one, kept with its date. The
        questions are not added to your map.
      </p>

      <div className="mt-4">
        <Label htmlFor="external-name">Name</Label>
        <Input
          id="external-name"
          name="name"
          maxLength={120}
          placeholder="SaaS metrics, 30 questions"
          className="mt-1"
        />
      </div>

      <div className="mt-4">
        <Label htmlFor="external-set">Questions and answers</Label>
        <Textarea
          id="external-set"
          name="set"
          rows={8}
          className="mt-1"
          placeholder={'What does NRR measure?\tRevenue kept from existing customers, with expansion\nWhat is the Rule of 40? | Growth rate plus profit margin should reach 40%'}
        />
        <p className="mt-1 text-small text-ink-muted">
          One per line: the question, a tab or a bar with spaces round it, then the answer.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" pending={pending}>
          {pending ? 'Keeping…' : 'Start the set'}
        </Button>
        {state.error && <span className="text-ui text-danger">{state.error}</span>}
      </div>
    </form>
  );
}
