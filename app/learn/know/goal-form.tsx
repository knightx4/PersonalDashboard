'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { MasteryChecks } from '@/components/learn/mastery-checks';
import { KindBadge } from '@/components/learn/kind-badge';
import type { ChainNode, ProposedChain } from '@/lib/learn/graph/chain-payload';
import { approveChain, proposeGoal, type ApproveState, type ProposeState } from './actions';

/**
 * Name a goal, then look at what it proposes before any of it is real.
 *
 * The approval step is not politeness. A generated graph is the thing every
 * later question gets asked against, so a wrong one is worse than none at all,
 * and a person reading eight claims for ten seconds is the cheapest check
 * available — much cheaper than finding out from a probe session built on top
 * of it.
 *
 * What is shown is therefore the claims themselves rather than a tidy list of
 * names. A name tells you nothing about whether the node is right; the claim
 * is the thing you can disagree with.
 */

function AskButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      <Sparkles className="size-4" strokeWidth={2} aria-hidden />
      {pending ? 'Laying it out…' : 'Lay out the chain'}
    </Button>
  );
}

function ApproveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Approve and save'}
    </Button>
  );
}

function NodeRow({ node, isGoal }: { node: ChainNode; isGoal: boolean }) {
  return (
    <li className="px-4 py-3">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-body font-medium text-ink">{node.name}</span>
        {node.existingId ? (
          <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
            Already in this subject
          </span>
        ) : (
          <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">New</span>
        )}
        {isGoal && (
          <span className="rounded-pill bg-accent-soft px-1.5 py-0.5 text-small text-accent">
            What you asked for
          </span>
        )}
        {/* Only on a new node: approving writes nothing for one the subject
            already has, so the mark shown would not be the mark stored. */}
        {!node.existingId && <KindBadge kind={node.kind} />}
      </p>

      {/* The claim, because it is the thing you can disagree with. A list of
          names gives you nothing to check. */}
      {node.claim && <p className="mt-0.5 text-ui text-ink">{node.claim}</p>}
      {node.basis && <p className="mt-0.5 text-small text-ink-muted">{node.basis}</p>}

      {/* Only under a new node: approving writes nothing for one the subject
          already has, so its checks are not what will be stored. */}
      {!node.existingId && <MasteryChecks checks={node.mastery} className="mt-1" />}
    </li>
  );
}

function Proposal({ chain, asked }: { chain: ProposedChain; asked: string }) {
  const [state, approve] = useActionState<ApproveState, FormData>(approveChain, {});
  const added = chain.nodes.filter((node) => !node.existingId).length;

  return (
    <form action={approve} className="mt-6">
      <input type="hidden" name="asked" value={asked} />
      <input type="hidden" name="chain" value={JSON.stringify(chain)} />

      <p className="mb-2 text-body text-ink-muted">
        {added === 0
          ? `Nothing new — every rung of this is already in ${chain.subject}.`
          : `${added} new ${added === 1 ? 'concept' : 'concepts'} in ${chain.subject}${
              chain.joined > 0 ? `, joined onto ${chain.joined} you already had` : ''
            }. Nothing is saved until you approve it.`}
      </p>

      <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {chain.nodes.map((node) => (
          <NodeRow
            key={node.name}
            node={node}
            isGoal={node.name.toLowerCase() === chain.goalConcept.toLowerCase()}
          />
        ))}
      </ul>

      {chain.dropped.length > 0 && (
        // Said out loud rather than swallowed: what it proposed and could not
        // place is the clearest signal that the goal was too broad.
        <p className="mt-2 text-small text-ink-muted">
          Left out: {chain.dropped.map((d) => `${d.name} (${d.reason})`).join(', ')}.
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <ApproveButton />
        {state.error && <span className="text-ui text-danger">{state.error}</span>}
      </div>
    </form>
  );
}

export function GoalForm({ subjectId }: { subjectId?: string }) {
  const [state, propose] = useActionState<ProposeState, FormData>(proposeGoal, {});

  if (state.chain && state.asked) {
    return <Proposal chain={state.chain} asked={state.asked} />;
  }

  return (
    <form action={propose} className={cn(cardVariants({ padding: 'standard' }), 'mt-6')}>
      {subjectId && <input type="hidden" name="subjectId" value={subjectId} />}

      <Field
        label="What do you want to understand?"
        id="goal"
        hint="As specific as you can make it. A narrow goal gets a short chain that is actually right; a broad one gets a shallow sweep."
      >
        <Input
          id="goal"
          name="goal"
          required
          maxLength={300}
          placeholder="How raising a policy rate reaches the price of anything"
        />
      </Field>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <AskButton />
        {state.error && <span className="text-ui text-danger">{state.error}</span>}
      </div>

      <p className="mt-2 text-small text-ink-muted">
        Lays out the things you would have to understand first, in order. Nothing is saved until you
        have read it.
      </p>
    </form>
  );
}
