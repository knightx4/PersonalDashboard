import { DetailFacts, DetailPage } from '@/components/patterns/list-detail';
import { Property } from '@/components/shell/detail-layout';
import { PageHeader, type Subject } from '@/components/shell/page-header';
import { EvidenceList } from '@/components/learn/evidence-list';
import { Disclosure } from '@/components/ui/disclosure';
import { Thread } from '@/components/thread/thread';
import { Card } from '@/components/ui/card';
import type { DevComment } from '@/lib/comments/load';
import { whenDay } from '@/lib/core/when';
import { ladderLevel } from '@/lib/learn/levels/ladder';
import type { EvidenceLink } from '@/lib/learn/evidence/model';
import { reachWords, type TopicStanding } from '@/lib/learn/levels/standing';
import type { TopicDetail, TopicMatch } from '@/lib/learn/levels/store';
import { threadRef } from '@/lib/thread/subjects';
import { draftProvenance } from '@/lib/learn/levels/provenance';
import { CardNote, DraftChecks, MarkPersonalForm, RowSource } from './draft-checks';
import { ApproveDraft, ApproveTopicButton, DraftMatch, WantedRow } from './draft-parts';
import { LadderView, type LadderOpen } from './ladder-view';

/**
 * One topic (plan #2138.2). A draft is the approval screen: what it covers,
 * any topic you already have that it looks like, then every level with its
 * checks open to rewording, then the approve button. An approved topic shows
 * the same levels to read.
 *
 * An approved topic shows the ladder (#2138.3): where you stand on each level
 * and why, from the model's reading of the evidence, with each level's
 * wording open to rewording.
 *
 * It also says how wide and how deep you stand, as two numbers kept apart by
 * kind (plan #2172.2), and what backs the frame topic it refines, each mark
 * with its kind and the most it can count for.
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
  standing = null,
  backing = [],
  open,
}: {
  topic: TopicDetail;
  /** The closest topic already on the map, shown beside a draft. */
  match: TopicMatch | null;
  comments: readonly DevComment[];
  path: Subject;
  timezone: string;
  now: number;
  /** Where you stand on each level; an approved topic has it, a draft does not. */
  standing?: TopicStanding | null;
  /** The evidence on the frame topic this one refines, mentions left out. */
  backing?: readonly EvidenceLink[];
  /** The gallery's way to draw a part that opens on a press. */
  open?: LadderOpen;
}) {
  const draft = topic.status === 'draft';
  const provenance = draft ? draftProvenance(topic) : null;
  const levels = topic.ceiling === 1 ? '1' : `1 to ${topic.ceiling}`;
  const reach = standing && !draft ? reachWords(standing.reach) : null;

  return (
    <DetailPage
      header={<PageHeader subject={path} title={topic.name} actions={draft ? <ApproveTopicButton uncited={provenance?.uncited.length} /> : undefined} />}
      details={
        <DetailFacts>
          {standing && !draft ? (
            <Property
              label="Your level"
              value={standing.level === 0 ? 'Not placed yet' : `${standing.level} of ${topic.ceiling}`}
              hint={
                standing.level === 0
                  ? undefined
                  : `${ladderLevel(standing.level).band}: you can ${ladderLevel(standing.level).can}`
              }
            />
          ) : (
            <Property label="Status" value={draft ? 'Draft' : 'Approved'} />
          )}
          <Property label="Levels" value={levels} />
          {reach && (
            <>
              <Property label="Breadth" value={reach.breadth} hint="Levels you hold, by how you showed them" wide />
              <Property label="Depth" value={reach.depth} hint="The highest level held each way" wide />
            </>
          )}
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
          {draft && <RowSource kind="topic" id={topic.id} citation={topic.citation} />}
        </Card>
      }
    >
      {draft && match && <DraftMatch topicId={topic.id} match={match} />}

      {draft && provenance && (
        <>
          <MarkPersonalForm topicId={topic.id} />
          <DraftChecks drafting={topic.drafting} provenance={provenance} />
        </>
      )}

      {draft ? (
        <ApproveDraft topicId={topic.id} cells={topic.cells} links={topic.links} />
      ) : (
        standing && <LadderView topicId={topic.id} standing={standing} open={open} timezone={timezone} now={now} />
      )}

      {!draft && backing.length > 0 && (
        <Card padding="standard">
          <Disclosure
            title="What backs it"
            meta={backing.length === 1 ? '1 mark' : `${backing.length} marks`}
            defaultOpen={open?.backing}
          >
            <EvidenceList links={backing} untested={standing?.untouched ?? true} limit={5} heading={false} />
          </Disclosure>
        </Card>
      )}

      {topic.wanted.length > 0 && (
        <section aria-labelledby="wanted-heading">
          <h2 id="wanted-heading" className="px-1 text-ui font-semibold text-ink">
            Topics it needs that you do not have
          </h2>
          <Card padding="none" className="mt-2">
            <CardNote>Drafting one links it in at the level shown.</CardNote>
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
