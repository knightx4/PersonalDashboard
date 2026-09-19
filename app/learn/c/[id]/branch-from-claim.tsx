'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Pencil, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { FieldError, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { KindBadge } from '@/components/learn/kind-badge';
import { MAX_SELECTION, normaliseSelection } from '@/lib/learn/graph/branch';
import type { ChainNode, ProposedChain } from '@/lib/learn/graph/chain-payload';
import { approveBranch, proposeBranch, rewriteClaim, type BranchState } from './actions';

/**
 * The claim, the offer to go deeper on a phrase in it, and the way to write it
 * yourself.
 *
 * The offer appears only while something is selected, which is what keeps it
 * out of the way of reading: a concept page is mostly read, and a button
 * sitting under every claim would be a permanent invitation to spend.
 *
 * The selection is read from `selectionchange` rather than from a mouse
 * event, so it works the same however the phrase got selected -- dragging,
 * double-clicking, or shift-arrowing through it from the keyboard.
 *
 * Rewriting is a separate control rather than `EditableProse` over the claim.
 * That component's read state is a button wrapping the text, and a claim
 * inside a button is a claim you can no longer select a phrase out of -- the
 * two things this page offers over the same sentence would cancel each other
 * out. So the claim stays a paragraph, and one quiet control swaps it for the
 * editor.
 */

function AskButton({ pending }: { pending: boolean }) {
  return (
    // Without this the mousedown that starts the click collapses the
    // selection, the offer unmounts, and the click lands on nothing.
    <Button
      type="submit"
      variant="secondary"
      size="sm"
      pending={pending}
      onMouseDown={(event) => event.preventDefault()}
    >
      <Sparkles className="size-3.5" strokeWidth={2} aria-hidden />
      {pending ? 'Laying it out…' : 'Learn this'}
    </Button>
  );
}

function ApproveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" pending={pending}>
      {pending ? 'Saving…' : 'Approve and save'}
    </Button>
  );
}

function NodeRow({ node, isGoal }: { node: ChainNode; isGoal: boolean }) {
  return (
    <li className="px-4 py-3">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-ui font-medium text-ink">{node.name}</span>
        <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
          {node.existingId ? 'Already in this subject' : 'New'}
        </span>
        {isGoal && (
          <span className="rounded-pill bg-accent-soft px-1.5 py-0.5 text-small text-accent">
            What you selected
          </span>
        )}
        {!node.existingId && <KindBadge kind={node.kind} />}
      </p>

      {node.claim && <p className="mt-0.5 text-ui text-ink">{node.claim}</p>}
      {node.basis && <p className="mt-0.5 text-small text-ink-muted">{node.basis}</p>}
    </li>
  );
}

function Proposal({
  chain,
  conceptId,
  selection,
  onDiscard,
}: {
  chain: ProposedChain;
  conceptId: string;
  selection: string;
  onDiscard: () => void;
}) {
  const [state, approve] = useActionState<BranchState, FormData>(approveBranch, {});
  const added = chain.nodes.filter((node) => !node.existingId).length;

  if (state.message) return <p className="mb-5 text-ui text-ink-muted">{state.message}</p>;

  return (
    <form action={approve} className="mb-5">
      <input type="hidden" name="conceptId" value={conceptId} />
      <input type="hidden" name="selection" value={selection} />
      <input type="hidden" name="chain" value={JSON.stringify(chain)} />

      <p className="mb-2 text-ui text-ink-muted">
        {added === 0
          ? `Nothing new — every rung of this is already in ${chain.subject}.`
          : `${added} new ${added === 1 ? 'concept' : 'concepts'} under “${selection}”${
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
        <p className="mt-2 text-small text-ink-muted">
          Left out: {chain.dropped.map((d) => `${d.name} (${d.reason})`).join(', ')}.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <ApproveButton />
        <Button type="button" variant="ghost" size="sm" onClick={onDiscard}>
          Discard
        </Button>
        {state.error && <span className="text-ui text-danger">{state.error}</span>}
      </div>
    </form>
  );
}

/**
 * The claim, in the editor.
 *
 * Saving is explicit and cancelling puts the paragraph back, which is what
 * keeps the selection offer available: this is only ever on screen while
 * somebody is deliberately rewriting. The two keys anybody typing in a box
 * expects work, the same pair `EditableProse` binds.
 */
function ClaimEditor({
  conceptId,
  claim,
  onDone,
}: {
  conceptId: string;
  claim: string;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(claim);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const result = await rewriteClaim({ conceptId, claim: draft });
      if (result.error) {
        setError(result.error);
        return;
      }
      onDone();
    });
  }

  return (
    <div className="mb-5 space-y-2">
      {/* ui-ok: composer-always-open -- ClaimEditor renders only once somebody
        * has pressed the rewrite control, and that gate is in the parent
        * component, which the rule cannot see across. Law 14 is obeyed. */}
      <Textarea
        autoFocus
        aria-label="The claim, in your own words"
        value={draft}
        rows={4}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onDone();
          } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            save();
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" pending={pending} onClick={save}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <span className="text-small text-ink-muted">
          The next question about this is written against your wording.
        </span>
        <FieldError>{error}</FieldError>
      </div>
    </div>
  );
}

export function BranchFromClaim({
  conceptId,
  claim,
  wording,
}: {
  conceptId: string;
  claim: string;
  /**
   * Whose words the claim is in, as a finished sentence. Written on the
   * server, because the date is in the account's timezone.
   */
  wording: string;
}) {
  const claimRef = useRef<HTMLParagraphElement>(null);
  const [selection, setSelection] = useState('');
  const [state, propose, asking] = useActionState<BranchState, FormData>(proposeBranch, {});
  const [discarded, setDiscarded] = useState<ProposedChain | null>(null);
  const [rewriting, setRewriting] = useState(false);

  useEffect(() => {
    function read() {
      const node = claimRef.current;
      const current = document.getSelection();
      if (!node || !current || current.isCollapsed || current.rangeCount === 0) {
        setSelection('');
        return;
      }
      // Anchored anywhere but in the claim, this is somebody selecting
      // something else on the page and nothing to do with going deeper.
      const range = current.getRangeAt(0);
      if (!node.contains(range.commonAncestorContainer)) {
        setSelection('');
        return;
      }
      setSelection(normaliseSelection(current.toString()));
    }

    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, []);

  const chain = state.chain && state.chain !== discarded ? state.chain : null;
  const tooLong = selection.length > MAX_SELECTION;

  if (rewriting) {
    return <ClaimEditor conceptId={conceptId} claim={claim} onDone={() => setRewriting(false)} />;
  }

  return (
    <>
      {/* The claim, which is the concept. Everything else on this page is
          about it. */}
      <p ref={claimRef} className="mb-1 text-body text-ink">
        {claim}
      </p>

      {/* Directly under the sentence, because it is about that sentence and
          nothing else on the page. */}
      <p className="mb-3 text-small text-ink-muted">{wording}</p>

      {chain && state.selection ? (
        <Proposal
          chain={chain}
          conceptId={conceptId}
          selection={state.selection}
          onDiscard={() => setDiscarded(chain)}
        />
      ) : (
        <div className="mb-5 min-h-7">
          {/* The same line the selection offer uses, so the claim is followed
              by one row rather than two. Nothing selected means nothing to
              branch off, which is when rewriting is the thing on offer. */}
          {selection.length === 0 && !asking && (
            <button
              type="button"
              onClick={() => setRewriting(true)}
              className="press inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-small text-ink-ghost transition-colors duration-150 hover:bg-sunken hover:text-ink-muted"
            >
              <Pencil className="size-3" strokeWidth={1.75} aria-hidden />
              Write this claim yourself
            </button>
          )}

          {/* Kept up while the call is in flight: clicking away clears the
              selection, and the offer vanishing mid-call reads as nothing
              having happened. */}
          {(selection.length > 0 || asking) && (
            <form action={propose} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="conceptId" value={conceptId} />
              <input type="hidden" name="selection" value={selection} />

              {tooLong ? (
                <p className="text-small text-ink-muted">
                  That is a paragraph rather than a phrase — select the part you want to
                  understand.
                </p>
              ) : (
                <>
                  <AskButton pending={asking} />
                  <span className="text-small text-ink-muted">
                    Lays out what “{selection}” rests on, in this subject. Nothing is saved
                    until you have read it.
                  </span>
                </>
              )}
            </form>
          )}

          {state.message && <p className="text-ui text-ink-muted">{state.message}</p>}
          {state.error && <p className="text-ui text-danger">{state.error}</p>}
        </div>
      )}
    </>
  );
}
