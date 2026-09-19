'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/field';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { MasteryChecks } from '@/components/learn/mastery-checks';
import { KindBadge } from '@/components/learn/kind-badge';
import { keepTicked, type ChainNode, type ProposedChain } from '@/lib/learn/graph/chain-payload';
import { approveBrief, proposeBrief, type BriefState } from './actions';

/**
 * Paste the briefing somebody wrote for you.
 *
 * The third way into the graph and the only one that starts from a document.
 * A goal says what you are missing and a prior-learning paste says what you
 * already have; this takes prose that was handed to you -- a pass per token,
 * the market, the company -- and reads out the claims a reader would have to
 * understand to follow it.
 *
 * Everything lands unknown, which is what makes an import worth doing at all:
 * an unknown concept can be probed, ordered against the rest and pointed at
 * something to read, and a claim declared known on arrival is a claim nothing
 * will ever ask you about.
 *
 * So the tick is per claim. A briefing is a document, not an answer, and some
 * of what comes out of one is a paragraph the model took too seriously.
 * Unticking a row can leave another with nothing holding it in place, and that
 * is shown here rather than discovered on the subject page afterwards.
 */

const key = (name: string) => name.trim().toLowerCase();

function ReadButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      <FileText className="size-4" strokeWidth={2} aria-hidden />
      {pending ? 'Reading it…' : 'Read the briefing'}
    </Button>
  );
}

function ImportButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || count === 0}>
      {pending ? 'Saving…' : `Add ${count} ${count === 1 ? 'claim' : 'claims'} to learn`}
    </Button>
  );
}

function ClaimRow({
  node,
  ticked,
  unplaced,
  onToggle,
}: {
  node: ChainNode;
  ticked: boolean;
  unplaced: boolean;
  onToggle: () => void;
}) {
  if (node.existingId) {
    return (
      <li className="px-4 py-3">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-body font-medium text-ink">{node.name}</span>
          {/* Not tickable: it is already in the subject, this import writes
              nothing for it, and it is here because the edges around it are
              what join the new claims to what you have. */}
          <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
            Already in this subject
          </span>
        </p>
        {node.claim && <p className="mt-0.5 text-ui text-ink">{node.claim}</p>}
      </li>
    );
  }

  return (
    <li className="flex gap-3 px-4 py-3">
      <input
        type="checkbox"
        checked={ticked}
        onChange={onToggle}
        name="keep"
        value={node.name}
        aria-label={`Keep ${node.name}`}
        className="mt-1 size-4 shrink-0 rounded border-border text-accent focus:ring-accent/30"
      />
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-body font-medium text-ink">{node.name}</span>
          <KindBadge kind={node.kind} />
          {unplaced && (
            <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
              Nothing left to hang it on
            </span>
          )}
        </span>
        {/* The claim, because the name says nothing about whether it is worth
            keeping, and the basis, because it says which part of the briefing
            put it there. */}
        {node.claim && <span className="mt-0.5 block text-ui text-ink">{node.claim}</span>}
        {node.basis && <span className="mt-0.5 block text-small text-ink-muted">{node.basis}</span>}
        <MasteryChecks checks={node.mastery} className="mt-1" />
      </span>
    </li>
  );
}

export function Proposal({ chain, onDiscard }: { chain: ProposedChain; onDiscard: () => void }) {
  const [state, approve] = useActionState<BriefState, FormData>(approveBrief, {});
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set(chain.nodes.filter((node) => !node.existingId).map((node) => key(node.name))),
  );

  // The same rule the server applies on approval, applied here so the cost of
  // unticking a row is visible before the button is pressed.
  const { chain: kept, unplaced } = useMemo(() => keepTicked(chain, ticked), [chain, ticked]);
  const unplacedNames = new Set(unplaced.map((node) => key(node.name)));
  const adding = kept.nodes.filter((node) => !node.existingId).length;

  return (
    <form action={approve} className="mt-6">
      <input type="hidden" name="chain" value={JSON.stringify(chain)} />

      <p className="mb-2 text-body text-ink-muted">
        {`${adding} ${adding === 1 ? 'claim' : 'claims'} for ${chain.subject}${
          chain.joined > 0 ? `, joined onto ${chain.joined} you already had` : ''
        }. They land as things to learn, not things you know — untick anything the briefing was wrong about or you do not care to learn. Nothing is saved until you add them.`}
      </p>

      <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {chain.nodes.map((node) => (
          <ClaimRow
            key={node.name}
            node={node}
            ticked={ticked.has(key(node.name))}
            unplaced={unplacedNames.has(key(node.name))}
            onToggle={() =>
              setTicked((current) => {
                const next = new Set(current);
                if (next.has(key(node.name))) next.delete(key(node.name));
                else next.add(key(node.name));
                return next;
              })
            }
          />
        ))}
      </ul>

      {unplaced.length > 0 && (
        <p className="mt-2 text-small text-ink-muted">
          Ticked but not added: {unplaced.map((node) => node.name).join(', ')} — nothing you kept
          says what {unplaced.length === 1 ? 'it sits' : 'they sit'} under or on top of.
        </p>
      )}

      {chain.dropped.length > 0 && (
        // Said out loud rather than swallowed. A section the import could not
        // read is the difference between a briefing that came in whole and one
        // that came in two thirds, and it is not visible anywhere else.
        <p className="mt-2 text-small text-ink-muted">
          The import left out: {chain.dropped.map((d) => `${d.name} (${d.reason})`).join(', ')}.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ImportButton count={adding} />
        {/* Writes nothing and asks nothing again: the proposal is thrown away
            and the paste box comes back. */}
        <Button type="button" variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
        {state.error && <span className="text-ui text-danger">{state.error}</span>}
        {state.message && <span className="text-ui text-ink-muted">{state.message}</span>}
      </div>
    </form>
  );
}

export function BriefForm({
  subjects,
  maxChars,
}: {
  subjects: { id: string; name: string }[];
  /** What the import will read, from the server that does the reading. */
  maxChars: number;
}) {
  const [state, propose] = useActionState<BriefState, FormData>(proposeBrief, {});
  const [discarded, setDiscarded] = useState<ProposedChain | null>(null);

  const chain = state.chain;
  if (chain && chain !== discarded) {
    return <Proposal chain={chain} onDiscard={() => setDiscarded(chain)} />;
  }

  return (
    <form action={propose} className={cn(cardVariants({ padding: 'standard' }), 'mt-6')}>
      {subjects.length > 0 && (
        <Field
          label="Which subject?"
          id="brief-subject"
          hint="Leave it open and the import names one. Choosing a subject you already have is what stops it proposing claims that are in there already."
        >
          <Select id="brief-subject" name="subjectId" defaultValue="">
            <option value="">A new subject</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field
        label="Paste the briefing"
        id="briefing"
        hint="Prose somebody prepared for you — a pass per topic, the background, the argument. It reads claims, so a table of numbers or a list of names has nothing in it to take."
        className={subjects.length > 0 ? 'mt-4' : undefined}
      >
        {/* ui-ok: composer-always-open -- the create. Pasting the briefing is
          * the only thing this form does, and there is nothing to read before
          * it has been pasted. */}
        <Textarea
          id="briefing"
          name="briefing"
          required
          rows={6}
          maxLength={maxChars}
          placeholder="Ethereum Classic — the chain that kept the original ledger after the DAO fork. Its security budget is a fraction of Ethereum's, which is why…"
        />
      </Field>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ReadButton />
        {state.error && <span className="text-ui text-danger">{state.error}</span>}
        {/* Not an error: a briefing that argues nothing is a normal thing to
            paste, and the sentence that comes back says what would work. */}
        {state.message && <span className="text-ui text-ink-muted">{state.message}</span>}
      </div>

      <p className="mt-2 text-small text-ink-muted">
        Everything it finds is shown before any of it is saved, and lands as something still to
        learn.
      </p>
    </form>
  );
}
