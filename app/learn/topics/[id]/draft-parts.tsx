'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { SectionLabel } from '@/components/ui/section-heading';
import Link from '@/components/ui/link';
import type { WantedTopic } from '@/lib/learn/levels/draft-payload';
import { ladderLevel } from '@/lib/learn/levels/ladder';
import type { TopicCellView, TopicLinkView, TopicMatch } from '@/lib/learn/levels/store';
import {
  draftWantedTopic,
  mergeTopicDraft,
  type MergeState,
  type WantedState,
} from './actions';
import { RowSource } from './draft-checks';

/**
 * The parts of a held draft's page (plan #2138.2): why it is held, the match
 * beside it with merge or keep both, its levels to read, and a topic its
 * links need, drafted on a press. Nothing here approves: Dash does that when
 * the draft is written (plan #2356).
 */

/** What a level needs from other topics, under its checks, each with where it came from. */
export function LevelNeeds({ links }: { links: readonly TopicLinkView[] }) {
  if (links.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-1">
      {links.map((link) => (
        <li key={`${link.topicId}:${link.level}`} className="text-small text-ink-muted">
          Needs{' '}
          <Link href={`/learn/topics/${link.topicId}`} className="text-ink hover:text-accent">
            {link.topicName} {link.level}
          </Link>
          {link.why && <span>: {link.why}</span>}
          {link.id && <RowSource kind="link" id={link.id} citation={link} />}
        </li>
      ))}
    </ul>
  );
}

function MergeButton({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" pending={pending}>
      {pending ? 'Merging…' : `Merge into ${name}`}
    </Button>
  );
}

/**
 * A topic already on the map that this draft looks like, shown above the
 * levels so it is read before them. Merging drops the draft and opens the
 * topic you had; keeping both puts the card away. Which one is right is yours to say, never decided for you
 * (LEARN-LEVELS-SPEC, "Drafting a topic").
 */
export function DraftMatch({ topicId, match }: { topicId: string; match: TopicMatch }) {
  const [kept, setKept] = useState(false);
  const [state, merge] = useActionState<MergeState, FormData>(mergeTopicDraft, {});
  if (kept) return null;

  const close = match.similarity >= 0.999 ? 'Same name as' : 'Close to';
  return (
    <Card padding="dense" className="space-y-2" aria-labelledby="draft-match-heading">
      <p id="draft-match-heading" className="text-ui text-ink">
        {close} a topic you already have.{' '}
        <span className="text-ink-muted">Two topics for one thing would split what you show between them.</span>
      </p>
      <div className="rounded-control bg-sunken px-3 py-2">
        <Link href={`/learn/topics/${match.id}`} className="text-ui font-medium text-ink hover:text-accent">
          {match.name}
        </Link>
        <span className="ml-2 text-small text-ink-muted">
          {match.status === 'draft' ? 'also a draft' : `levels 1 to ${match.ceiling}`}
        </span>
        <p className="mt-0.5 text-small text-ink-muted">{match.scope}</p>
      </div>
      <form action={merge} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="topicId" value={topicId} />
        <input type="hidden" name="intoId" value={match.id} />
        <MergeButton name={match.name} />
        <Button type="button" size="sm" variant="ghost" onClick={() => setKept(true)}>
          Keep both
        </Button>
        {state.error && (
          <span role="alert" className="text-small text-danger">
            {state.error}
          </span>
        )}
      </form>
    </Card>
  );
}

/**
 * Why a draft is still a draft. Dash approves one as soon as it is written,
 * so one that is held is a draft whose approval did not go through. The page
 * says so, then names what it can see in the rows.
 */
export function HeldNotice({ reasons }: { reasons: readonly string[] }) {
  return (
    <Card padding="dense" className="space-y-1" aria-labelledby="held-heading">
      <p id="held-heading" className="text-ui font-semibold text-ink">
        Held: Dash could not approve this draft
      </p>
      <p className="text-ui text-ink">
        Dash approves a draft as soon as it is written. Until this one is approved, nothing is asked about it.
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-small text-ink-muted">
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </Card>
  );
}

/** Every level of a held draft with its checks, read as text. */
export function DraftLevels({
  cells,
  links,
}: {
  cells: readonly TopicCellView[];
  links: readonly TopicLinkView[];
}) {
  return (
    <section aria-labelledby="levels-heading">
      <h2 id="levels-heading" className="mb-2 px-1 text-ui font-semibold text-ink">
        The levels
      </h2>
      <Card padding="none">
        <ol className="divide-y divide-border">
          {cells.map((cell) => {
            const rung = ladderLevel(cell.level);
            return (
              <li key={cell.id} className="card-pad-x py-3">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="tabular text-ui font-semibold text-ink">{cell.level}</span>
                  <SectionLabel as="span">{rung.band}</SectionLabel>
                  <span className="min-w-0 text-small text-ink-muted">You can {rung.can}</span>
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ui text-ink">
                  {cell.checks.map((check) => (
                    <li key={check}>{check}</li>
                  ))}
                </ul>
                <RowSource kind="cell" id={cell.id} citation={cell} />
                <LevelNeeds links={links.filter((l) => l.fromLevel === cell.level)} />
              </li>
            );
          })}
        </ol>
      </Card>
    </section>
  );
}

function DraftItButton() {
  const { pending } = useFormStatus();
  return (
    <DashAction
      type="submit"
      size="sm"
      variant="secondary"
      pending={pending}
      paid="app/learn/topics/[id]/actions.ts#draftWantedTopic"
      what="Cost of drafting it"
      hintFirst
    >
      {pending ? 'Sending…' : 'Draft it'}
    </DashAction>
  );
}

/** One topic the draft's links need that the map does not have. */
export function WantedRow({ topicId, wanted }: { topicId: string; wanted: WantedTopic }) {
  const [state, draft] = useActionState<WantedState, FormData>(draftWantedTopic, {});
  return (
    <li className="card-pad-x flex flex-wrap items-start gap-x-3 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-ui text-ink">
          {wanted.name}
          <span className="ml-2 text-small text-ink-muted">
            level {wanted.level}, for level {wanted.from_level} here
          </span>
        </p>
        <p className="mt-0.5 text-small text-ink-muted">{wanted.why ?? wanted.scope}</p>
        {state.error && (
          <p role="alert" className="mt-1 text-small text-danger">
            {state.error}
          </p>
        )}
        {state.queued && (
          <p role="status" className="mt-1 text-small text-ink-muted">
            {state.queued}
          </p>
        )}
      </div>
      <form action={draft}>
        <input type="hidden" name="topicId" value={topicId} />
        <input type="hidden" name="name" value={wanted.name} />
        <input type="hidden" name="scope" value={wanted.scope} />
        <DraftItButton />
      </form>
    </li>
  );
}
