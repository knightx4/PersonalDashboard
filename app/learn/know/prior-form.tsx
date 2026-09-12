'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { MasteryChecks } from '@/components/learn/mastery-checks';
import type { ChainNode, ProposedChain } from '@/lib/learn/graph/chain-payload';
import { approvePrior, proposePrior, type PriorState } from './actions';

/**
 * Tell it what you already know.
 *
 * Every other way into the graph waits for you to do something in this
 * application, and none of them can reach what you learned before it existed.
 * This one takes the account you can write in five minutes -- or the essay and
 * the syllabus you already have -- and turns it into nodes that are settled
 * from the start.
 *
 * Which is exactly why nothing is written until it has been read. A concept
 * that lands as known is one the views will never show you again: that is the
 * pruning rule the whole graph rests on, and it means a wrong node here is
 * invisible from the moment it goes in. So the claims are shown, not the
 * names, and the basis under each one says what in your own account put it
 * there.
 */

function ReadButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      <GraduationCap className="size-4" strokeWidth={2} aria-hidden />
      {pending ? 'Reading it…' : 'Read what I know'}
    </Button>
  );
}

function KeepButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Approve and mark known'}
    </Button>
  );
}

function ClaimRow({ node }: { node: ChainNode }) {
  return (
    <li className="px-4 py-3">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-body font-medium text-ink">{node.name}</span>
        {node.existingId ? (
          // Said plainly, because this row is the one exception to what the
          // button does: a concept already in the graph keeps whatever state
          // it arrived at, and approving does not reach it.
          <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
            Already in this subject — left as it is
          </span>
        ) : (
          <span className="rounded-pill bg-accent-soft px-1.5 py-0.5 text-small text-accent">
            New, and will be marked known
          </span>
        )}
      </p>

      {node.claim && <p className="mt-0.5 text-ui text-ink">{node.claim}</p>}
      {node.basis && <p className="mt-0.5 text-small text-ink-muted">{node.basis}</p>}

      {/* Only under a new node: a concept already in the subject is left as it
          is, checks included. */}
      {!node.existingId && <MasteryChecks checks={node.mastery} className="mt-1" />}
    </li>
  );
}

function Proposal({ chain }: { chain: ProposedChain }) {
  const [state, approve] = useActionState<PriorState, FormData>(approvePrior, {});
  const added = chain.nodes.filter((node) => !node.existingId).length;

  return (
    <form action={approve} className="mt-6">
      <input type="hidden" name="chain" value={JSON.stringify(chain)} />

      <p className="mb-2 text-body text-ink-muted">
        {added === 0
          ? `Nothing new — ${chain.subject} already holds all of this.`
          : `${added} ${added === 1 ? 'claim' : 'claims'} in ${chain.subject}, settled on your word alone. They will show as known, and say “you said so” wherever the graph shows how a state was reached. Nothing is saved until you approve it.`}
      </p>

      <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {chain.nodes.map((node) => (
          <ClaimRow key={node.name} node={node} />
        ))}
      </ul>

      {chain.dropped.length > 0 && (
        <p className="mt-2 text-small text-ink-muted">
          Left out: {chain.dropped.map((d) => `${d.name} (${d.reason})`).join(', ')}.
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <KeepButton />
        {state.error && <span className="text-ui text-danger">{state.error}</span>}
      </div>
    </form>
  );
}

export function PriorForm({ subjectId }: { subjectId?: string }) {
  const [state, propose] = useActionState<PriorState, FormData>(proposePrior, {});

  if (state.chain) return <Proposal chain={state.chain} />;

  return (
    <form action={propose} className={cn(cardVariants({ padding: 'standard' }), 'mt-6')}>
      {subjectId && <input type="hidden" name="subjectId" value={subjectId} />}

      <Field
        label="What do you already know?"
        id="account"
        hint="An essay, a syllabus you can say something about, a write-up of work you cannot paste. Say what you understood, not what you attended — a list of course titles has nothing in it to read."
      >
        {/* ui-ok: composer-always-open -- the create. This page is the form:
          * writing the account of what you know is the only thing it does, and
          * there is nothing to read before it exists. */}
        <Textarea
          id="account"
          name="account"
          required
          rows={5}
          maxLength={20000}
          placeholder="We spent Macro I on IS-LM and I never believed the LM curve — the central bank sets the rate, it does not sit on a money supply and let the rate clear."
        />
      </Field>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ReadButton />
        {state.error && <span className="text-ui text-danger">{state.error}</span>}
        {/* Not an error: a paste with no claims in it is a normal thing to
            happen here, and the sentence that comes back says what would work
            instead. */}
        {state.message && <span className="text-ui text-ink-muted">{state.message}</span>}
      </div>

      <p className="mt-2 text-small text-ink-muted">
        What comes back is marked known from the start, so it is shown to you before any of it is
        real.
      </p>
    </form>
  );
}
