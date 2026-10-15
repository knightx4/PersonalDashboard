import { DetailFacts, DetailPage } from '@/components/patterns/list-detail';
import { Property } from '@/components/shell/detail-layout';
import { PageHeader, type Subject } from '@/components/shell/page-header';
import { Thread } from '@/components/thread/thread';
import { Card } from '@/components/ui/card';
import { SectionLabel } from '@/components/ui/section-heading';
import type { DevComment } from '@/lib/comments/load';
import { whenDay } from '@/lib/core/when';
import { ladderLevel } from '@/lib/learn/levels/ladder';
import type { TopicDetail, TopicMatch } from '@/lib/learn/levels/store';
import { threadRef } from '@/lib/thread/subjects';
import { ApproveDraft, ApproveTopicButton, DraftMatch, LevelNeeds, WantedRow } from './draft-parts';

/**
 * One topic (plan #2138.2). A draft is the approval screen: what it covers,
 * any topic you already have that it looks like, then every level with its
 * checks open to rewording, then the approve button. An approved topic shows
 * the same levels to read.
 *
 * The ladder with where you stand on each level is the topic page's next
 * step (#2138.3); this page shows the topic as it is written.
 *
 * The page and the gallery both draw this, so it takes the rows and reads
 * nothing itself.
 */
export function TopicView({
  topic,
  match,
  comments,
  path,
  timezone,
  now,
}: {
  topic: TopicDetail;
  /** The closest topic already on the map, shown beside a draft. */
  match: TopicMatch | null;
  comments: readonly DevComment[];
  path: Subject;
  timezone: string;
  now: number;
}) {
  const draft = topic.status === 'draft';
  const levels = topic.ceiling === 1 ? '1' : `1 to ${topic.ceiling}`;

  return (
    <DetailPage
      header={<PageHeader subject={path} title={topic.name} actions={draft ? <ApproveTopicButton /> : undefined} />}
      details={
        <DetailFacts>
          <Property label="Status" value={draft ? 'Draft' : 'Approved'} />
          <Property label="Levels" value={levels} />
          <Property
            label={draft ? 'Drafted' : 'Approved'}
            value={whenDay((draft ? null : topic.approvedAt) ?? topic.createdAt, { timeZone: timezone, now })}
          />
          <Property
            label="Fields"
            value={topic.fieldNames.length > 0 ? topic.fieldNames.join(', ') : 'None'}
            hint={topic.fieldNames.join(', ') || undefined}
          />
        </DetailFacts>
      }
      text={
        <Card padding="dense" aria-label="What it covers" className="space-y-1">
          <p className="text-body text-ink">{topic.scope}</p>
          {topic.asked && topic.asked.toLowerCase() !== topic.name.toLowerCase() && (
            <p className="text-small text-ink-muted">Drafted from what you asked: “{topic.asked}”</p>
          )}
        </Card>
      }
    >
      {draft && match && <DraftMatch topicId={topic.id} match={match} />}

      {draft ? (
        <ApproveDraft topicId={topic.id} cells={topic.cells} links={topic.links} />
      ) : (
        <section aria-labelledby="levels-heading">
          <h2 id="levels-heading" className="mb-2 px-1 text-ui font-semibold text-ink">
            The levels
          </h2>
          <Card padding="none">
            <ol className="divide-y divide-border">
              {topic.cells.map((cell) => {
                const rung = ladderLevel(cell.level);
                return (
                  <li key={cell.id} className="card-pad-x py-3">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="tabular text-ui font-semibold text-ink">{cell.level}</span>
                      <SectionLabel as="span">{rung.band}</SectionLabel>
                      {cell.rewrittenAt && <span className="text-small text-ink-muted">in your words</span>}
                    </p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ui text-ink">
                      {cell.checks.map((check) => (
                        <li key={check}>{check}</li>
                      ))}
                    </ul>
                    <LevelNeeds links={topic.links.filter((l) => l.fromLevel === cell.level)} />
                  </li>
                );
              })}
            </ol>
          </Card>
        </section>
      )}

      {topic.wanted.length > 0 && (
        <section aria-labelledby="wanted-heading">
          <h2 id="wanted-heading" className="px-1 text-ui font-semibold text-ink">
            Topics it needs that you do not have
          </h2>
          <p className="mb-2 px-1 text-small text-ink-muted">
            Drafting one links it in at the level shown.
          </p>
          <Card padding="none">
            <ul className="divide-y divide-border">
              {topic.wanted.map((wanted) => (
                <WantedRow key={wanted.name} topicId={topic.id} wanted={wanted} />
              ))}
            </ul>
          </Card>
        </section>
      )}

      <Card padding="dense" aria-label="Comments">
        <Thread
          subject={threadRef('topic', topic.id)}
          turns={comments}
          placeholder={draft ? 'What is wrong with this draft, or what it should cover.' : 'A note on this topic.'}
        />
      </Card>
    </DetailPage>
  );
}
