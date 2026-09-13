import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { CardSection } from '@/components/ui/card';
import { Group } from '@/components/ui/disclosure';
import { ESTABLISHED_LABEL, STATE_LABEL, StateMark } from '@/components/learn/concept-state';
import { KIND_LINE } from '@/components/learn/kind-badge';
import { MasteryChecks } from '@/components/learn/mastery-checks';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadConceptView } from '@/lib/learn/graph/concept';
import { probesFor, type ProbeRow } from '@/lib/learn/graph/session';
import type { Concept, Mentioned } from '@/lib/learn/graph/model';
import { ReadAbout } from '@/app/learn/s/[id]/read-about';
import { BranchFromClaim } from './branch-from-claim';

export const dynamic = 'force-dynamic';

/**
 * One concept: the claim, where it stands, what it sits between, and what has
 * been asked about it.
 *
 * The subject page shows a claim inside a chain, which is the right frame for
 * deciding what to learn next and the wrong one for reading about a single
 * idea. This is the page a link can point at -- from a card, from another
 * claim that mentions this one, from a highlight somebody wants to branch off
 * -- and it computes nothing the subject page does not already compute.
 *
 * Two things on it write, and both ask first: taking a gap to the reading
 * queue, which is the same action and the same two ids as the card it came
 * from, and branching a chain off a phrase selected in the claim, which is
 * proposed and approved like any other goal.
 */

function ConceptLink({ concept }: { concept: Concept }) {
  return (
    <li className="flex gap-2">
      <StateMark concept={concept} className="mt-1" />
      <div className="min-w-0">
        <Link href={`/learn/c/${concept.id}`} className="text-ui text-ink hover:text-accent">
          {concept.name}
        </Link>
        <span className="ml-2 text-small text-ink-muted">{STATE_LABEL[concept.state]}</span>
        <p className="text-small text-ink-muted">{concept.claim}</p>
      </div>
    </li>
  );
}

/**
 * The same row, plus the sentence saying why the link is there.
 *
 * A mention is the one link on this page that is not a prerequisite, so it
 * carries its basis where an edge does not: "this is mentioned by that" is
 * worth nothing without the reason, and the reason is what stops a link from
 * quietly becoming a claim about learning order.
 */
function MentionLink({ mention }: { mention: Mentioned }) {
  return (
    <li className="flex gap-2">
      <StateMark concept={mention.concept} className="mt-1" />
      <div className="min-w-0">
        <Link
          href={`/learn/c/${mention.concept.id}`}
          className="text-ui text-ink hover:text-accent"
        >
          {mention.concept.name}
        </Link>
        <span className="ml-2 text-small text-ink-muted">
          {STATE_LABEL[mention.concept.state]}
        </span>
        <p className="text-small text-ink-muted">{mention.basis}</p>
      </div>
    </li>
  );
}

/**
 * What was asked and what it settled.
 *
 * The reason is shown only for a question that was answered, which is the
 * rule the probe session works to: it was written at the same time as the
 * question, and reading it first is reading the answer.
 */
function Probe({ probe }: { probe: ProbeRow }) {
  const chosen = probe.chosenIndex === null ? null : probe.options[probe.chosenIndex];
  const correct = probe.options[probe.correctIndex];
  const right = probe.chosenIndex === probe.correctIndex;

  return (
    <li>
      <p className="text-ui text-ink">{probe.question}</p>
      <p className={right ? 'text-small text-ink-muted' : 'text-small text-danger'}>
        {chosen === null
          ? 'Asked, not answered.'
          : right
            ? `You picked “${chosen}”, which is right.`
            : `You picked “${chosen}”. The answer was “${correct}”.`}
      </p>
      {chosen !== null && <p className="mt-0.5 text-small text-ink-muted">{probe.reason}</p>}
    </li>
  );
}

export default async function ConceptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createLearnClient();
  // Somebody else's concept reads as no row at all, so it lands here as a 404
  // rather than as a page saying whose it is.
  const view = await loadConceptView(supabase, id);
  if (!view) notFound();

  const { concept, subject, prerequisites, dependents, refersTo, referredToBy } = view;
  const probes = await probesFor(supabase, concept.id);

  const connected =
    prerequisites.length > 0 ||
    dependents.length > 0 ||
    refersTo.length > 0 ||
    referredToBy.length > 0;

  return (
    <>
      <p className="mb-3">
        <Link
          href={`/learn/s/${subject.id}`}
          className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          {subject.name}
        </Link>
      </p>

      <PageHeader title={concept.name} />

      {/* The claim, and the offer to branch off a phrase in it. */}
      <BranchFromClaim conceptId={concept.id} claim={concept.claim} />

      <CardSection title="Where it stands" className="mb-5">
        <p className="flex gap-2 text-ui text-ink">
          <StateMark concept={concept} className="mt-0.5" />
          <span>
            {STATE_LABEL[concept.state]}
            {concept.state !== 'unknown' && ` — ${ESTABLISHED_LABEL[concept.established]}`}
          </span>
        </p>

        {concept.misconception && <p className="mt-2 text-ui text-danger">{concept.misconception}</p>}

        {/* Which kind of node it is, said only when somebody judged it: a
            concept from before the marks existed says nothing here. */}
        {concept.kind && <p className="mt-2 text-ui text-ink-muted">{KIND_LINE[concept.kind]}</p>}

        {/* Why the node is in this subject at all, which is a different claim
            from what you know about it. */}
        <p className="mt-2 text-small text-ink-muted">{concept.basis}</p>

        <div className="mt-3">
          <ReadAbout concept={concept} subjectId={subject.id} />
        </div>
      </CardSection>

      {/* What having this claim looks like, and what the questions about it are
          written against. Its own section rather than a line under the claim:
          it is a list, and the card above is about where the claim stands. */}
      <CardSection title="What understanding it looks like" className="mb-5">
        <MasteryChecks checks={concept.mastery} />
      </CardSection>

      {connected && (
        <CardSection title="How it connects" className="mb-5">
          <div className="space-y-4">
            {prerequisites.length > 0 && (
              <Group title="It rests on">
                <ul className="space-y-2">
                  {prerequisites.map((row) => (
                    <ConceptLink key={row.id} concept={row} />
                  ))}
                </ul>
              </Group>
            )}

            {dependents.length > 0 && (
              <Group title="Rests on it">
                <ul className="space-y-2">
                  {dependents.map((row) => (
                    <ConceptLink key={row.id} concept={row} />
                  ))}
                </ul>
              </Group>
            )}

            {/* Below the prerequisites, and separately, because they are a
                different claim: these say the briefing brought the two up
                together, not that either has to be learned first. A concept
                with none of them shows neither heading. */}
            {refersTo.length > 0 && (
              <Group title="It refers to">
                <ul className="space-y-2">
                  {refersTo.map((row) => (
                    <MentionLink key={row.concept.id} mention={row} />
                  ))}
                </ul>
              </Group>
            )}

            {referredToBy.length > 0 && (
              <Group title="Refers to it">
                <ul className="space-y-2">
                  {referredToBy.map((row) => (
                    <MentionLink key={row.concept.id} mention={row} />
                  ))}
                </ul>
              </Group>
            )}
          </div>
        </CardSection>
      )}

      <CardSection
        title="Questions asked"
        hint={
          probes.length === 0
            ? undefined
            : 'Newest first, with what you picked and why the answer is the answer.'
        }
      >
        {probes.length === 0 ? (
          <p className="text-ui text-ink-muted">
            Nothing has been asked about this yet.{' '}
            <Link
              href={`/learn/s/${subject.id}/probe`}
              className="underline underline-offset-2 hover:text-ink"
            >
              Probe this subject
            </Link>{' '}
            and it will come up.
          </p>
        ) : (
          <ul className="space-y-3">
            {probes.map((probe) => (
              <Probe key={probe.id} probe={probe} />
            ))}
          </ul>
        )}
      </CardSection>
    </>
  );
}
