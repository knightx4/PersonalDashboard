import { Layers } from 'lucide-react';
import { DetailFacts, DetailPage } from '@/components/patterns/list-detail';
import { Property } from '@/components/shell/detail-layout';
import { PageHeader, type Subject } from '@/components/shell/page-header';
import { Thread } from '@/components/thread/thread';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import Link from '@/components/ui/link';
import { Meter } from '@/components/ui/meter';
import { SectionLabel } from '@/components/ui/section-heading';
import type { DevComment } from '@/lib/comments/load';
import { whenDay } from '@/lib/core/when';
import type { LensDetailView, LensTopicView } from '@/lib/learn/levels/lenses';
import type { LensSource } from '@/lib/learn/levels/lens-store';
import { threadRef } from '@/lib/thread/subjects';
import { TargetsEditor } from './targets-editor';

/**
 * One lens (docs/LEARN-LEVELS-SPEC.md, "Lenses: subjects and goals"; plan
 * #2138.7): a subject or a learning goal seen as topics, each with a target
 * level. The facts say how much of the way there you are; under them, how
 * many topics sit in each band; then each topic as a bar to its target, with
 * the levels you are ready for inside the lens one press away; then the
 * comments.
 *
 * Edit opens the targets as one form, a level a topic. The page and the
 * gallery both draw this, so it takes the rows and reads nothing itself.
 */

/** The gallery's way to draw a part that opens on a press. */
export type LensOpen = { fringe?: string };

export function LensView({
  id,
  name,
  source,
  createdAt,
  detail,
  comments,
  path,
  editing = false,
  open,
  timezone,
  now,
}: {
  id: string;
  name: string;
  source: LensSource;
  createdAt: string;
  detail: LensDetailView;
  comments: readonly DevComment[];
  path: Subject;
  /** The targets open as a form (`?edit=1`). */
  editing?: boolean;
  open?: LensOpen;
  timezone: string;
  now: number;
}) {
  const { progress, topics } = detail;
  const approved = topics.filter((t) => t.approved);
  const drafts = topics.length - approved.length;
  const percent = Math.round(progress.fraction * 100);
  const canEdit = topics.length > 0 && !editing;
  // Nothing held on any topic: a share would be a measured 0 of nothing.
  const started = progress.held > 0;

  return (
    <DetailPage
      header={
        <PageHeader
          subject={path}
          title={name}
          actions={
            canEdit ? (
              <Link href={`/learn/lens/${id}?edit=1`} className={buttonVariants({ variant: 'secondary' })}>
                Edit targets
              </Link>
            ) : undefined
          }
        />
      }
      details={
        <DetailFacts>
          {topics.length > 0 && (
            <>
              <Property
                label="Held"
                value={started ? `${percent}%` : 'Not started'}
                hint={started ? `${progress.held} of ${progress.total} levels up to the targets` : undefined}
              />
              <Property
                label="Topics"
                value={drafts > 0 ? `${approved.length}, ${drafts} draft` : String(approved.length)}
              />
            </>
          )}
          <Property label="From" value={<SourceValue source={source} />} />
          <Property label="Since" value={whenDay(createdAt, { timeZone: timezone, now })} />
        </DetailFacts>
      }
      text={approved.length > 0 ? <Standing detail={detail} /> : undefined}
    >
      {topics.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={source?.kind === 'goal' ? 'No topics on this goal yet' : 'No topics on this subject yet'}
          description={
            source?.kind === 'subject'
              ? 'Name something you want to understand on the subject’s page, or move the subject’s ideas onto topics, and each topic lands here with a target level.'
              : 'A goal takes the topics of its subject, at the depth you set for it. Once its subject has topics, they show here.'
          }
          action={
            source?.kind === 'subject'
              ? { label: 'Open the subject', href: `/learn/s/${source.subjectId}` }
              : { label: 'Your topics', href: '/learn/topics' }
          }
        />
      ) : editing ? (
        <TargetsEditor lensId={id} topics={topics} />
      ) : (
        <section aria-labelledby="lens-topics-heading">
          <h2 id="lens-topics-heading" className="mb-2 px-1 text-ui font-semibold text-ink">
            Topics
          </h2>
          <Card padding="none">
            <ul className="divide-y divide-border">
              {topics.map((topic) => (
                <TopicRow key={topic.topicId} topic={topic} open={open?.fringe === topic.topicId} started={started} />
              ))}
            </ul>
          </Card>
        </section>
      )}

      <Card padding="dense" aria-label="Comments">
        <Thread subject={threadRef('lens', id)} turns={comments} placeholder="A note on this lens." />
      </Card>
    </DetailPage>
  );
}

function SourceValue({ source }: { source: LensSource }) {
  if (!source) return <>Removed</>;
  if (source.kind === 'subject') {
    return (
      <Link href={`/learn/s/${source.subjectId}`} className="press-area text-ink hover:text-accent">
        Subject
      </Link>
    );
  }
  const depth = source.depth === 'deep' ? 'deep' : source.depth === 'solid' ? 'solid' : 'familiar';
  const label = `Goal, ${depth}`;
  return source.goalId ? (
    <Link href={`/goals/${source.goalId}`} className="press-area text-ink hover:text-accent">
      {label}
    </Link>
  ) : (
    <>{label}</>
  );
}

/**
 * How far along the lens is: one bar for the whole lens, the topics in each
 * band of the ladder, and a line when a topic joined today and pulled the
 * bar back, or when nothing has been shown yet.
 */
function Standing({ detail }: { detail: LensDetailView }) {
  const { progress, bands, addedToday } = detail;
  const unplaced = bands.find((band) => band.band === 'Unplaced')?.topics ?? 0;
  if (progress.held === 0) {
    // Nothing answered yet: no bar and no row of zeros, only what is so.
    const approved = detail.topics.filter((t) => t.approved).length;
    return (
      <Card padding="dense" aria-label="How far along" className="space-y-1">
        <p className="text-ui text-ink">Nothing shown yet. Practice Flow places you on each topic with its first question.</p>
        <p className="tabular text-small text-ink-muted">
          {progress.total} levels to the targets across {approved === 1 ? '1 topic' : `${approved} topics`}.
        </p>
      </Card>
    );
  }
  return (
    <Card padding="dense" aria-label="How far along" className="space-y-3">
      <div>
        <p className="tabular text-ui text-ink">
          {progress.held} of {progress.total} levels held, up to the targets
        </p>
        <Meter
          value={progress.held}
          max={progress.total}
          height="md"
          className="mt-1.5"
          label={`${progress.held} of ${progress.total} levels held`}
        />
      </div>
      <dl className="grid grid-cols-4 gap-2">
        {bands.filter((band) => band.band !== 'Unplaced').map((band) => (
          <div key={band.band} className="min-w-0">
            <SectionLabel as="dt">{band.band}</SectionLabel>
            <dd className={band.topics === 0 ? 'tabular text-ui text-ink-ghost' : 'tabular text-ui text-ink'}>
              {band.topics}
            </dd>
          </div>
        ))}
      </dl>
      {unplaced > 0 && (
        <p className="text-small text-ink-muted">
          {unplaced === 1 ? '1 topic is' : `${unplaced} topics are`} not placed yet.
        </p>
      )}
      {addedToday.length > 0 && (
        <p className="text-small text-ink-muted">
          Added today: {addedToday.join(', ')}. A new topic adds levels to reach, so the share held drops until you
          practise it.
        </p>
      )}
    </Card>
  );
}

function TopicRow({ topic, open, started }: { topic: LensTopicView; open: boolean; started: boolean }) {
  if (!topic.approved) {
    return (
      <li className="card-pad-x row-pad">
        <Link href={`/learn/topics/${topic.topicId}`} className="press-area block text-ui text-ink hover:text-accent">
          {topic.name}
        </Link>
        <p className="text-small text-ink-muted">Draft to approve. It counts once you approve it.</p>
      </li>
    );
  }

  const reached = topic.level >= topic.target;
  const ready = topic.fringe.length;
  return (
    <li className="card-pad-x row-pad">
      <div className="flex items-baseline justify-between gap-3">
        <Link href={`/learn/topics/${topic.topicId}`} className="press-area min-w-0 truncate text-ui text-ink hover:text-accent">
          {topic.name}
        </Link>
        <span className="tabular shrink-0 text-small text-ink-muted">
          {/* On a lens nothing is placed on, the card above says so once. */}
          {topic.level > 0 ? `Level ${topic.level} · ` : started ? 'Not placed · ' : ''}target {topic.target}
        </span>
      </div>
      <Meter
        value={topic.held}
        max={topic.total}
        className="mt-1.5"
        label={`${topic.name}: ${topic.held} of ${topic.total} levels up to the target held`}
      />
      {reached ? (
        <p className="mt-1 text-small text-ink-muted">Target reached.</p>
      ) : ready > 0 ? (
        <Disclosure
          title={<span className="font-normal text-ink-muted">Ready next</span>}
          meta={ready === 1 ? '1 level' : `${ready} levels`}
          defaultOpen={open}
          className="mt-1"
        >
          <ul className="space-y-2">
            {topic.fringe.map((cell) => (
              <li key={cell.cellId} className="text-small">
                <p className="text-ink">
                  <span className="tabular font-medium">Level {cell.level}</span>
                  <span className="text-ink-muted"> · {cell.band}: you can {cell.can}</span>
                </p>
                <p className="text-ink-muted">{cell.why}</p>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : (
        <p className="mt-1 text-small text-ink-muted">Nothing ready yet: the next level needs another topic first.</p>
      )}
    </li>
  );
}
