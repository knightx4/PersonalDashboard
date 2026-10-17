'use client';

import { useState, useTransition } from 'react';
import { DetailFacts, DetailPage } from '@/components/patterns/list-detail';
import { Property } from '@/components/shell/detail-layout';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { FieldError } from '@/components/ui/field';
import { SectionLabel } from '@/components/ui/section-heading';
import { cn } from '@/lib/cn';
import {
  answersText,
  keepBothCarry,
  linksText,
  pairHref,
  similarityPercent,
  standingText,
  stateWord,
  suggestedKeep,
  type IdeaPair,
  type PairIdea,
} from '@/lib/learn/map/idea-pairs';
import { PAIRS_SUBJECT } from './pairs-view';

type Settle = (form: FormData) => Promise<{ ok: false; error: string } | void>;

/**
 * One pair of ideas that may be the same idea in two subjects (plan
 * #2147.2), in the list-and-detail pattern: the header with Merge and Keep
 * both, the facts, then the two ideas side by side, then what each choice
 * does.
 *
 * The merge keeps the idea with more behind it unless the person picks the
 * other. Nothing is done until they press one of the two: closeness found
 * the pair, and only they decide it is one idea. `merge` and `keepBoth` are
 * the server actions, left out in the gallery.
 */
export function IdeaPairView({
  pair,
  merge,
  keepBoth,
}: {
  pair: IdeaPair;
  merge?: Settle;
  keepBoth?: Settle;
}) {
  const [keepId, setKeepId] = useState(() => suggestedKeep(pair).id);
  const keep = keepId === pair.a.id ? pair.a : pair.b;
  const other = keep.id === pair.a.id ? pair.b : pair.a;
  const carry = keepBothCarry(pair);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function runKeepBoth() {
    if (!keepBoth) return;
    setError(null);
    start(async () => {
      const form = new FormData();
      form.set('a', pair.a.id);
      form.set('b', pair.b.id);
      form.set('similarity', String(pair.similarity));
      const result = await keepBoth(form);
      if (result && result.ok === false) setError(result.error);
    });
  }

  const lost = other.links > 0 ? `, and its ${linksText(other.links)} in ${other.subject.name} go with it` : '';

  const header = (
    <PageHeader
      subject={{
        ref: null,
        path: [...PAIRS_SUBJECT.path, { label: keep.name, href: pairHref(pair.a.id, pair.b.id) }],
      }}
      title={keep.name}
      description={`${similarityPercent(pair.similarity)} alike, in ${pair.a.subject.name} and ${pair.b.subject.name}.`}
      actions={
        <>
          <Button variant="secondary" size="sm" pending={pending} onClick={runKeepBoth}>
            {pending ? 'Keeping…' : 'Keep both'}
          </Button>
          <ConfirmStep
            variant="primary"
            confirmVariant="primary"
            prompt={`“${other.name}” is removed and its answers move to “${keep.name}”${lost}.`}
            confirmLabel="Yes, merge"
            pendingLabel="Merging…"
            action={merge}
            fields={{ keep: keep.id, retire: other.id, similarity: String(pair.similarity) }}
          >
            Merge
          </ConfirmStep>
        </>
      }
    />
  );

  return (
    <DetailPage
      header={header}
      details={
        <>
          <DetailFacts>
            <Property label="Alike" value={similarityPercent(pair.similarity)} />
            <Property label="Merge keeps" value={keep.subject.name} hint={keep.name} />
            <Property
              label="Keeping both"
              value={carry ? `${stateWord(carry.state)} carried across` : 'Nothing carried'}
              hint={
                carry
                  ? `“${carry.to.name}” would start as ${stateWord(carry.state).toLowerCase()}, inferred from “${carry.from.name}”.`
                  : undefined
              }
            />
            <Property label="Links lost on merge" value={other.links} />
          </DetailFacts>
          <FieldError>{error}</FieldError>
        </>
      }
      text={
        <section aria-label="The two ideas" className="grid gap-3 sm:grid-cols-2">
          <IdeaCard idea={pair.a} kept={pair.a.id === keep.id} onKeep={() => setKeepId(pair.a.id)} />
          <IdeaCard idea={pair.b} kept={pair.b.id === keep.id} onKeep={() => setKeepId(pair.b.id)} />
        </section>
      }
    >
      <Card padding="standard" role="region" aria-labelledby="pair-choices" className="space-y-2 text-body text-ink-muted">
        <h2 id="pair-choices" className="text-ui font-semibold text-ink">
          What each does
        </h2>
        <p>
          <span className="text-ink">Merge</span> leaves one idea, “{keep.name}”, in both subjects, with
          everything you answered about either.
        </p>
        <p>
          <span className="text-ink">Keep both</span> leaves them as two ideas and stops listing them as a pair.
          {carry
            ? ` You know “${carry.from.name}” from a question, so “${carry.to.name}” starts as known too, marked inferred.`
            : ''}
        </p>
      </Card>
    </DetailPage>
  );
}

function IdeaCard({ idea, kept, onKeep }: { idea: PairIdea; kept: boolean; onKeep: () => void }) {
  return (
    <Card padding="standard" className={cn('flex flex-col gap-2', kept && 'border-accent')}>
      <SectionLabel>{idea.subject.name}</SectionLabel>
      <h2 className="text-ui font-semibold text-ink [overflow-wrap:anywhere]">{idea.name}</h2>
      <p className="text-body text-ink [overflow-wrap:anywhere]">{idea.claim}</p>
      <p className="tabular text-small text-ink-muted">
        {standingText(idea)} · {answersText(idea.answers)} · {linksText(idea.links)}
      </p>
      <div className="mt-auto pt-1">
        {kept ? (
          <p className="text-small text-accent">Kept if you merge</p>
        ) : (
          <Button variant="ghost" size="sm" className="-ml-2.5" onClick={onKeep}>
            Keep this one instead
          </Button>
        )}
      </div>
    </Card>
  );
}
