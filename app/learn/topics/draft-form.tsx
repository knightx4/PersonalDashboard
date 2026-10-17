'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { DashAction } from '@/components/ui/dash-action';
import { ComposeBody, ComposeBox, Field, Input, Textarea } from '@/components/ui/field';
import { sectionSubject } from '@/lib/core/section-path';
import { sourcesFromText } from '@/lib/learn/levels/draft-sources';
import { draftTopicFromGoal, type DraftState } from './actions';

/**
 * The topics page's header and its one action (plan #2138.2): New topic
 * opens a box to name what you want to know, and Draft the topic sends it.
 *
 * Edit sources (plan #2138.11) opens what the topic is drafted from: the
 * goal's performances, pasted sources, and a phrase naming roles you pursued
 * whose requirement lines join them. With none, every row of the draft comes
 * back uncited and has to be marked personal before it can be approved.
 *
 * The press takes a while: two calls write every level of the topic, side by
 * side, so the two drafts can be compared. While they run the box is shut and
 * one line says so, so the goal cannot be sent twice. On success the action
 * opens the draft's page; on failure the reason shows inside the box, with
 * everything still in it to send again.
 *
 * `shown` is for the gallery, which draws the box open, mid-draft, with an
 * error or with its sources open, without pressing anything.
 */

export type ComposeShown = {
  pending?: boolean;
  error?: string;
  goal?: string;
  /** The source list open, with these in it. */
  sources?: { performances?: string; sources?: string; roles?: string };
};

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
      what="Cost of drafting the topic twice"
      hintFirst
      wrapperClassName="ml-auto"
    >
      {pending ? 'Drafting it twice to compare…' : 'Draft the topic'}
    </DashAction>
  );
}

/** "2 sources, 7 lines" once something is pasted, so a source scrolled out of the box still counts. */
function sourceCount(text: string): string | null {
  const sources = sourcesFromText(text);
  if (sources.length === 0) return null;
  const lines = sources.reduce((n, s) => n + s.items.length, 0);
  return `${sources.length} ${sources.length === 1 ? 'source' : 'sources'}, ${lines} ${lines === 1 ? 'line' : 'lines'}. A blank line starts the next source; its first line names it.`;
}

/**
 * Held in state rather than left to the form, so an error from the press,
 * which resets a form's own fields, does not throw away what was pasted.
 */
function SourceList({ shown, readOnly }: { shown?: ComposeShown['sources']; readOnly: boolean }) {
  const [performances, setPerformances] = useState(shown?.performances ?? '');
  const [sources, setSources] = useState(shown?.sources ?? '');
  const [roles, setRoles] = useState(shown?.roles ?? '');
  return (
    <div className="space-y-3">
      <Field
        id="draft-performances"
        label="What being able to do it means"
        hint="Three to five things, one a line. Each level is checked against them."
      >
        <Textarea
          id="draft-performances"
          name="performances"
          rows={3}
          readOnly={readOnly}
          value={performances}
          onChange={(event) => setPerformances(event.target.value)}
          placeholder="Build a three-statement model from a 10-K"
        />
      </Field>
      <Field
        id="draft-sources"
        label="Sources"
        hint={sourceCount(sources) ?? 'Paste a table of contents, a syllabus or an exam body’s outcome list. A blank line starts the next; its first line names it.'}
      >
        <Textarea
          id="draft-sources"
          name="sources"
          rows={5}
          readOnly={readOnly}
          className="max-h-[32rem]"
          value={sources}
          onChange={(event) => setSources(event.target.value)}
          placeholder={'CFA Level I, Equity valuation\nCalculate the value of a stock with a free cash flow model\nExplain the terminal value'}
        />
      </Field>
      <Field
        id="draft-roles"
        label="Roles you pursued"
        hint="Words in their titles, such as FP&A or controller. Their requirement lines join the sources."
      >
        <Input
          id="draft-roles"
          name="roles"
          maxLength={120}
          readOnly={readOnly}
          value={roles}
          onChange={(event) => setRoles(event.target.value)}
        />
      </Field>
    </div>
  );
}

function GoalBox({ shown, error }: { shown?: ComposeShown; error?: string }) {
  const { pending: sending } = useFormStatus();
  const pending = sending || shown?.pending === true;
  const [sourcesOpen, setSourcesOpen] = useState(shown?.sources !== undefined);
  return (
    <div className="space-y-2">
      <ComposeBox className="space-y-2 py-2.5" aria-busy={pending}>
        {/* A box that wraps, so a long question reads whole on a phone; Enter sends it. */}
        <ComposeBody
          name="goal"
          required
          rows={1}
          autoFocus={!shown}
          maxLength={300}
          defaultValue={shown?.goal}
          readOnly={pending}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          className="min-h-11 py-2.5 font-medium sm:text-body"
          aria-label="What do you want to know?"
          placeholder="What do you want to know?"
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-2">
          {!pending && (
            <Button
              type="button"
              size="sm"
              variant="link"
              aria-expanded={sourcesOpen}
              aria-controls="draft-source-list"
              onClick={() => setSourcesOpen((open) => !open)}
            >
              {sourcesOpen ? 'Hide sources' : 'Edit sources'}
            </Button>
          )}
          {error && !pending ? (
            <p role="alert" className="min-w-0 text-small text-danger">
              {error}
            </p>
          ) : (
            !pending && !sourcesOpen && <p className="min-w-0 text-small text-ink-muted">One topic, such as DCF.</p>
          )}
          <DraftButton forcePending={shown?.pending} />
        </div>
      </ComposeBox>
      {/* Under the box, so Draft the topic stays in reach; kept mounted once opened, so closing it does not drop what was pasted. */}
      <div id="draft-source-list" hidden={!sourcesOpen} className="rounded-card bg-sunken p-3">
        <SourceList shown={shown?.sources} readOnly={pending} />
      </div>
    </div>
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
