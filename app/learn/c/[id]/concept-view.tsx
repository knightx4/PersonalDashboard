import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { CardSection } from '@/components/ui/card';
import { Group } from '@/components/ui/disclosure';
import {
  ESTABLISHED_LABEL,
  LastChecked,
  RUNG_LABEL,
  STATE_LABEL,
  StateMark,
} from '@/components/learn/concept-state';
import { KIND_LINE } from '@/components/learn/kind-badge';
import { MasteryChecks } from '@/components/learn/mastery-checks';
import type { ClaimMaterialView } from '@/lib/learn/catalogue/material';
import { splitCase } from '@/lib/learn/graph/applied-payload';
import type { ConceptView } from '@/lib/learn/graph/concept';
import { claimWordingLine } from '@/lib/learn/graph/last-answered';
import { askedBeforeRewrite } from '@/lib/learn/graph/rewrite';
import type { ProbeRow } from '@/lib/learn/graph/session';
import type { OpeningQuestion } from '@/lib/learn/graph/opening';
import type { Concept, Mentioned } from '@/lib/learn/graph/model';
import type { CardNote } from '@/lib/learn/notes/notes';
import { ReadAbout } from '@/app/learn/s/[id]/read-about';
import { CardNotes } from '@/components/learn/card-notes';
import { deleteCardNote } from '@/app/learn/now/actions';
import { addConceptNote } from './actions';
import { BranchFromClaim } from './branch-from-claim';
import { MaterialForClaim, NoMaterialNote } from './material';
import { MapBranch, UnlocksMap } from './unlocks-map';
import { isLit, litRecently } from '@/lib/learn/graph/lit';
import { cn } from '@/lib/cn';

/**
 * What /learn/c/[id] draws, from what its page read: the page hands its reads
 * here so the gallery can draw it with fixtures (plan #1602).
 */

function ConceptLink({ concept, branch = false }: { concept: Concept; branch?: boolean }) {
  return (
    <li className={cn('flex gap-2', branch && 'relative')}>
      {branch && <MapBranch />}
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
        <span className="ml-2 text-small text-ink-muted">{STATE_LABEL[mention.concept.state]}</span>
        <p className="text-small text-ink-muted">{mention.basis}</p>
      </div>
    </li>
  );
}

/**
 * What was asked, at which rung, and what it settled.
 *
 * The reason is shown only for a question that was answered, which is the
 * rule the probe session works to: it was written at the same time as the
 * question, and reading it first is reading the answer. The answer a case was
 * written with follows the same rule, for the same reason.
 *
 * A question written before the claim was last rewritten says so. #382
 * settled that the answers keep their value -- rewriting a claim is usually
 * tidying a sentence rather than deciding the app had the idea wrong -- but
 * the page must not go on implying you were tested on wording that is no
 * longer there. Two timestamps compared, and nothing written.
 */
function Probe({ probe, claimRewrittenAt }: { probe: ProbeRow; claimRewrittenAt: string | null }) {
  const earlier = askedBeforeRewrite(probe.askedAt, claimRewrittenAt);

  // An applied case has no options and nothing picked: the situation, what was
  // typed and how it was graded are what there is to show. The two halves of
  // the case are stored in one column and split back out here, so the thing to
  // say about the situation reads as its own paragraph the way it does in the
  // session.
  if (probe.rung !== 'recognise') {
    const { situation, question } = splitCase(probe.question);
    const answered = probe.response !== null;
    const right = probe.responseCorrect === true;

    return (
      <li>
        <p className="text-small text-ink-muted">{RUNG_LABEL[probe.rung]}</p>
        {situation && <p className="mt-0.5 text-ui text-ink">{situation}</p>}
        <p className="mt-0.5 text-ui text-ink">{question}</p>
        {earlier && (
          <p className="text-small text-ink-muted">
            Written against the earlier wording of this idea.
          </p>
        )}
        <p
          className={
            answered && !right ? 'mt-1 text-small text-danger' : 'mt-1 text-small text-ink-muted'
          }
        >
          {answered ? `You wrote “${probe.response}”.` : 'Asked, not answered.'}
        </p>
        {answered && probe.gradeReason !== null && (
          <p className="mt-0.5 text-small text-ink-muted">{probe.gradeReason}</p>
        )}
        {answered && probe.expected !== null && (
          <p className="mt-0.5 text-small text-ink-muted">The answer expected: {probe.expected}</p>
        )}
      </li>
    );
  }

  const options = probe.options ?? [];
  const chosen = probe.chosenIndex === null ? null : options[probe.chosenIndex];
  const correct = probe.correctIndex === null ? null : options[probe.correctIndex];
  const right = probe.chosenIndex === probe.correctIndex;

  return (
    <li>
      <p className="text-small text-ink-muted">{RUNG_LABEL[probe.rung]}</p>
      <p className="mt-0.5 text-ui text-ink">{probe.question}</p>
      {earlier && (
        <p className="text-small text-ink-muted">
          Written against the earlier wording of this idea.
        </p>
      )}
      <p className={right ? 'mt-1 text-small text-ink-muted' : 'mt-1 text-small text-danger'}>
        {probe.dontKnow
          ? `You said you did not know. The answer was “${correct}”.`
          : chosen === null
            ? 'Asked, not answered.'
            : right
              ? `You picked “${chosen}”, which is right.`
              : `You picked “${chosen}”. The answer was “${correct}”.`}
      </p>
      {(chosen !== null || probe.dontKnow) && (
        <p className="mt-0.5 text-small text-ink-muted">{probe.reason}</p>
      )}
    </li>
  );
}


export type ConceptPageProps = {
  view: ConceptView;
  probes: ProbeRow[];
  opening: OpeningQuestion | null;
  material: ClaimMaterialView;
  notes: CardNote[];
  timezone: string;
  now: Date;
};

export function ConceptPageView({ view, probes, opening, material, notes, timezone, now }: ConceptPageProps) {
  const { concept, subject, prerequisites, dependents, refersTo, referredToBy } = view;

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
          className="press-area inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          {subject.name}
        </Link>
      </p>

      <PageHeader title={concept.name} />

      {/* The claim, the offer to branch off a phrase in it, and the way to
          write it yourself. */}
      <BranchFromClaim
        conceptId={concept.id}
        claim={concept.claim}
        wording={claimWordingLine(concept.claimRewrittenAt, now, timezone)}
      />

      {/* What the app first wrote, once there is a version of yours sitting
          where it was. Nothing to show on a claim you have never rewritten,
          and no heading either. */}
      {concept.claimOriginal && (
        <Group title="What the app first wrote" className="mb-5">
          <p className="max-w-prose text-ui text-ink-muted">{concept.claimOriginal}</p>
        </Group>
      )}

      {/* Your notes on the idea, next to the claim they are about: the ones
          written on its Learn now cards and the ones written here. */}
      <CardSection title="Your notes" className="mb-5">
        <CardNotes
          id={concept.id}
          cardId={null}
          notes={notes}
          add={addConceptNote.bind(null, concept.id)}
          remove={deleteCardNote}
          titled={false}
        />
      </CardSection>

      <CardSection title="Where it stands" className="mb-5">
        <p className="flex gap-2 text-ui text-ink">
          <StateMark concept={concept} className="mt-0.5" />
          <span>
            {STATE_LABEL[concept.state]}
            {concept.state !== 'unknown' && ` — ${ESTABLISHED_LABEL[concept.established]}`}
          </span>
        </p>

        {/* The date under the state, because "known" reads the same whether
            the question was yesterday or in March. */}
        <LastChecked concept={concept} timezone={timezone} className="mt-1 pl-6" />

        {concept.misconception && (
          <p className="mt-2 text-ui text-danger">{concept.misconception}</p>
        )}

        {/* Which kind of node it is, said only when somebody judged it: a
            concept from before the marks existed says nothing here. */}
        {concept.kind && <p className="mt-2 text-ui text-ink-muted">{KIND_LINE[concept.kind]}</p>}

        {/* Why the node is in this subject at all, which is a different claim
            from what you know about it. */}
        <p className="mt-2 text-small text-ink-muted">{concept.basis}</p>

        {/* Offered whatever state the claim is in: this page is where you ask
            for material on one claim, known or untested alike (#1070). */}
        <div className="mt-3">
          <ReadAbout concept={concept} subjectId={subject.id} anyState />
          {/* Where a claim with nothing found for it says why, under the
              button that goes looking. */}
          <NoMaterialNote view={material} />
        </div>
      </CardSection>

      {/* What was found, if anything was. Directly under where it stands,
          because what is worth reading depends on which rung you are at and
          that is the card above. */}
      <MaterialForClaim view={material} conceptId={concept.id} className="mb-5" />

      {/* What having this claim looks like, and what the questions about it are
          written against. Its own section rather than a line under the claim:
          it is a list, and the card above is about where the claim stands. */}
      <CardSection title="What understanding it looks like" className="mb-5">
        <MasteryChecks checks={concept.mastery} answers={probes} />
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
                {/* Drawn as a map, lit once the concept is known (plan #1562). */}
                <UnlocksMap
                  conceptId={concept.id}
                  name={concept.name}
                  lit={isLit(concept)}
                  play={litRecently(concept, now)}
                >
                  {dependents.map((row) => (
                    <ConceptLink key={row.id} concept={row} branch />
                  ))}
                </UnlocksMap>
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

      {opening && (
        <CardSection
          title="Asked before you started"
          hint="Answered from memory, before anything about this subject was laid out."
          className="mb-5"
        >
          <p className="text-ui text-ink">{opening.question}</p>
          <p className="mt-1 text-ui text-ink-muted">
            {opening.outcome === 'skipped'
              ? 'You passed on it.'
              : `You said: ${opening.response} — ${opening.outcome === 'right' ? 'right' : 'not quite'}.`}
          </p>
          <p className="mt-1 text-ui text-ink">{opening.expected}</p>
        </CardSection>
      )}

      <CardSection
        title="Questions asked"
        hint={
          probes.length === 0
            ? undefined
            : 'Newest first, with the kind of question each was and why the answer is the answer.'
        }
      >
        {probes.length === 0 ? (
          <p className="text-ui text-ink-muted">
            Nothing has been asked about this yet.{' '}
            <Link
              href={`/learn/s/${subject.id}/probe`}
              className="underline underline-offset-2 hover:text-ink"
            >
              Ask about this subject
            </Link>{' '}
            and it will come up.
          </p>
        ) : (
          <ul className="space-y-3">
            {probes.map((probe) => (
              <Probe key={probe.id} probe={probe} claimRewrittenAt={concept.claimRewrittenAt} />
            ))}
          </ul>
        )}
      </CardSection>
    </>
  );
}
