'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { SectionLabel } from '@/components/ui/section-heading';
import { Textarea } from '@/components/ui/field';
import Link from '@/components/ui/link';
import type { WantedTopic } from '@/lib/learn/levels/draft-payload';
import { ladderLevel } from '@/lib/learn/levels/ladder';
import type { TopicCellView, TopicLinkView, TopicMatch } from '@/lib/learn/levels/store';
import {
  approveTopicDraft,
  draftWantedTopic,
  mergeTopicDraft,
  type ApproveState,
  type MergeState,
  type WantedState,
} from './actions';
import { CardNote, RowSource } from './draft-checks';

/**
 * The parts of a draft topic's page that write (plan #2138.2): the match
 * beside the draft, with merge or keep both; the levels, every one of them
 * editable, with the approve button under them; and a topic the draft's
 * links need, drafted on a press.
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
 * topic you had; keeping both puts the card away and approval goes on as
 * usual. Which one is right is yours to say, never decided for you
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

/** The form the header's approve button sends, by id. */
const APPROVE_FORM = 'approve-topic';

/**
 * Approve, in the header so it is in reach without scrolling past ten
 * levels. It sends the levels form below it by id. While a row names no
 * source and is not marked personal it is shut, and the checks under the
 * header say which rows (plan #2138.11).
 */
export function ApproveTopicButton({ uncited = 0 }: { uncited?: number }) {
  return (
    <Button
      type="submit"
      size="sm"
      form={APPROVE_FORM}
      disabled={uncited > 0}
      title={uncited > 0 ? `${uncited} ${uncited === 1 ? 'row names' : 'rows name'} no source` : undefined}
    >
      Approve
    </Button>
  );
}

/**
 * One level's checks, read as text until pressed. Pressing turns that level
 * alone into a box to reword, one check a line; leaving the box shows the
 * new wording as text again. What the form sends is whatever is here.
 */
function LevelChecks({
  level,
  checks,
  problem,
}: {
  level: number;
  checks: readonly string[];
  problem?: string;
}) {
  const [text, setText] = useState(checks.join('\n'));
  const [editing, setEditing] = useState(problem !== undefined);
  const fieldId = `level-${level}`;
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  return (
    <>
      {editing ? (
        /* ui-ok: the step asks for every level's checks to be rewordable on the approval screen (idea 646e303d); the box opens only on a press */
        <Textarea
          id={fieldId}
          name={fieldId}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => setEditing(false)}
          autoFocus
          rows={Math.max(lines.length, 2)}
          aria-label={`Checks for level ${level}, one a line`}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${fieldId}-error` : undefined}
          className="mt-1.5 min-h-0"
        />
      ) : (
        <>
          <input type="hidden" name={fieldId} value={text} />
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Reword level ${level}`}
            className="press -mx-1.5 mt-1 block w-[calc(100%+0.75rem)] rounded-control px-1.5 py-1 text-left hover:bg-sunken"
          >
            <ul className="list-disc space-y-0.5 pl-5 text-ui text-ink">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </button>
        </>
      )}
      {problem && (
        <p id={`${fieldId}-error`} role="alert" className="mt-1 text-small text-danger">
          {problem}
        </p>
      )}
    </>
  );
}

/**
 * Every level of the draft, its checks read as text and each level reworded
 * in place on a press. What the levels say when Approve is pressed is what is
 * kept; a level you reworded keeps the drafted wording beside yours.
 */
export function ApproveDraft({
  topicId,
  cells,
  links,
}: {
  topicId: string;
  cells: readonly TopicCellView[];
  links: readonly TopicLinkView[];
}) {
  const [state, approve] = useActionState<ApproveState, FormData>(approveTopicDraft, {});

  return (
    <form id={APPROVE_FORM} action={approve} aria-labelledby="levels-heading">
      <input type="hidden" name="topicId" value={topicId} />
      <h2 id="levels-heading" className="mb-2 px-1 text-ui font-semibold text-ink">
        The levels
      </h2>
      {state.error && (
        <p role="alert" className="mb-2 px-1 text-small text-danger">
          {state.error}
        </p>
      )}
      <Card padding="none">
        <CardNote>Press a level to reword it. Nothing is asked until you approve.</CardNote>
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
                <LevelChecks level={cell.level} checks={cell.checks} problem={state.levels?.[cell.level]} />
                <RowSource kind="cell" id={cell.id} citation={cell} />
                <LevelNeeds links={links.filter((l) => l.fromLevel === cell.level)} />
              </li>
            );
          })}
        </ol>
      </Card>
    </form>
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
      {pending ? 'Drafting…' : 'Draft it'}
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
