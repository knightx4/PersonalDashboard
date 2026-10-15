'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { DashAction } from '@/components/ui/dash-action';
import { ComposeBox, ComposeTitle } from '@/components/ui/field';
import { sectionSubject } from '@/lib/core/section-path';
import { draftTopicFromGoal, type DraftState } from './actions';

/**
 * The topics page's header and its one action (plan #2138.2): New topic
 * opens a box to name what you want to know, and Draft the topic sends it.
 *
 * The press takes a while: one call writes every level of the topic. While
 * it runs the box is shut and one line says so, so the goal cannot be sent
 * twice. On success the action opens the draft's page; on failure the reason
 * shows inside the box, with the goal still in it to send again.
 *
 * `shown` is for the gallery, which draws the box open, mid-draft or with an
 * error, without pressing anything.
 */

export type ComposeShown = { pending?: boolean; error?: string; goal?: string };

function DraftButton({ forcePending }: { forcePending?: boolean }) {
  const { pending: sending } = useFormStatus();
  const pending = sending || forcePending === true;
  return (
    <DashAction
      type="submit"
      size="sm"
      variant={pending ? 'ghost' : 'secondary'}
      pending={pending}
      paid="app/learn/topics/actions.ts#draftTopicFromGoal"
      what="Cost of drafting the topic"
      hintFirst
      wrapperClassName="ml-auto"
    >
      {pending ? 'Drafting the levels…' : 'Draft the topic'}
    </DashAction>
  );
}

function GoalBox({ shown, error }: { shown?: ComposeShown; error?: string }) {
  const { pending: sending } = useFormStatus();
  const pending = sending || shown?.pending === true;
  return (
    <ComposeBox className="space-y-2 py-2.5" aria-busy={pending}>
      <ComposeTitle
        name="goal"
        required
        autoFocus={!shown}
        maxLength={300}
        defaultValue={shown?.goal}
        readOnly={pending}
        className="min-h-11"
        aria-label="What do you want to know?"
        placeholder="What do you want to know?"
      />
      <div className="flex items-center gap-2 border-t border-border pt-2">
        {error && !pending ? (
          <p role="alert" className="min-w-0 text-small text-danger">
            {error}
          </p>
        ) : (
          !pending && <p className="min-w-0 text-small text-ink-muted">One topic, such as DCF.</p>
        )}
        <DraftButton forcePending={shown?.pending} />
      </div>
    </ComposeBox>
  );
}

export function TopicsHeader({ shown }: { shown?: ComposeShown }) {
  const [open, setOpen] = useState(shown !== undefined);
  const [state, draft] = useActionState<DraftState, FormData>(draftTopicFromGoal, {});

  return (
    <>
      <PageHeader
        subject={sectionSubject('/learn/topics', 'Topics')}
        title="Topics"
        actions={
          open ? undefined : (
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              <Plus className="size-4" strokeWidth={1.75} aria-hidden />
              New topic
            </Button>
          )
        }
      />
      {open && (
        <form action={draft} className="mb-4" aria-label="Draft a topic">
          <GoalBox shown={shown} error={shown?.error ?? state.error} />
        </form>
      )}
    </>
  );
}
