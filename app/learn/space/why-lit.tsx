'use client';

import Link from '@/components/ui/link';
import {
  BookOpen,
  Briefcase,
  CircleCheck,
  FileText,
  GraduationCap,
  PlayCircle,
  type LucideIcon,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { CheckRow } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import {
  basisSentence,
  CARD_EVIDENCE_LIMIT,
  type EvidenceSourceKind,
} from '@/lib/learn/evidence/model';
import { bandWords } from '@/lib/learn/evidence/course-bands';
import { testedWords } from '@/lib/learn/evidence/course-explain';
import { KIND_WORDS } from '@/lib/learn/evidence/kinds';
import { practiceHref } from '@/lib/learn/flow/href';
import type { IdeaOnMap } from '@/lib/learn/map/load';
import type { Layers } from '@/lib/learn/map/layers';
import { readableName, type SkyTerritory, type TerritoryStanding } from '@/lib/learn/map/place-graph';
import { levelsText } from '@/lib/learn/map/topic-stars';
import { countText } from '@/lib/learn/map/view';
import { dueText, answerLine, quoteLabel, requirementsOf, standingText } from '@/lib/learn/map/why';

/**
 * Why a star is lit, in the rail (plan #2187.5): by kind, with the words of
 * the answer, when it fades and a way to be asked again. The layer switch
 * sits with it, since it changes what the sky shows of each kind.
 */

const KIND_ICON: Record<EvidenceSourceKind, LucideIcon> = {
  note: FileText,
  course: GraduationCap,
  work: Briefcase,
  reading: BookOpen,
  video: PlayCircle,
};

/** The switch for what the sky and a goal's popup draw: answers, courses and work, your writing. */
export function LayerSwitch({
  layers,
  onChange,
  className,
}: {
  layers: Layers;
  onChange: (next: Layers) => void;
  className?: string;
}) {
  const row = (key: keyof Layers, title: string, hint: string) => (
    <CheckRow
      key={key}
      title={title}
      hint={hint}
      checked={layers[key]}
      onChange={(event) => onChange({ ...layers, [key]: event.target.checked })}
    />
  );
  return (
    <fieldset className={className}>
      <legend className="text-ui font-semibold text-ink">On the sky</legend>
      {row('answers', 'Answers', 'Brightness, and the levels held in a subject')}
      {row('courses', 'Courses and work', 'A pale ring')}
      {row('writing', 'Writing', 'A pale ring')}
    </fieldset>
  );
}

/** A mark's own words: its kind, and the levels a course reached where it knows them. */
function markLine(link: IdeaOnMap['evidence'][number]): string {
  const band = link.tested
    ? ` · ${testedWords(link.tested)}`
    : link.band
      ? ` · ${bandWords(link.band)}`
      : '';
  return `${KIND_WORDS[link.kind]}${band} · rings it, never brightens it`;
}

/** One note, course or piece of work that touched a star, with its kind and what it does to the star. */
function item(link: IdeaOnMap['evidence'][number]) {
  const Icon = KIND_ICON[link.sourceKind];
  return (
    <li key={link.id} className="flex items-start gap-2 text-ui text-ink">
      <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0">
        <span className="block break-words">{basisSentence(link.basis)}</span>
        <span className="block text-small text-ink-muted">{markLine(link)}</span>
      </span>
    </li>
  );
}

/** How many of the ideas under a topic show before the rest fold away. */
const IDEAS_SHOWN = 3;

/**
 * The claims-graph ideas under a topic (plan #2317.2): they are no longer
 * stars, so a topic lists the ones attached to the Wikipedia topic it
 * refines, each opening its own page. Nothing is drawn for a topic with none.
 */
export function IdeasUnder({
  ideas = [],
  className,
}: {
  ideas?: readonly { id: string; name: string }[];
  className?: string;
}) {
  if (ideas.length === 0) return null;
  const row = (idea: { id: string; name: string }) => (
    <li key={idea.id}>
      <Link
        href={`/learn/c/${idea.id}`}
        className="flex min-h-11 items-center py-1.5 text-ui text-ink hover:text-accent"
      >
        {readableName(idea.name)}
      </Link>
    </li>
  );
  return (
    <section className={className} aria-label="Your ideas under it">
      <h3 className="text-ui font-semibold text-ink">
        Your ideas under it
        <span className="tabular ml-2 font-normal text-ink-muted">{countText(ideas.length)}</span>
      </h3>
      <ul className="mt-1 divide-y divide-border">{ideas.slice(0, IDEAS_SHOWN).map(row)}</ul>
      {ideas.length > IDEAS_SHOWN && (
        <Disclosure title={`${ideas.length - IDEAS_SHOWN} more`} className="mt-1" bodyClassName="pl-0">
          <ul className="divide-y divide-border">{ideas.slice(IDEAS_SHOWN).map(row)}</ul>
        </Disclosure>
      )}
    </section>
  );
}

/**
 * Why a star is lit, as the layers on show have it: what your answers made
 * of it, then each note, course or piece of work that touched it, strongest
 * first, and where it fades. Replaces the shared "What backs it" list here,
 * which counts evidence towards strength and so is wrong on this page.
 */
export function IdeaWhy({
  idea,
  asOf,
  layers,
  onLayers,
  moreOpen = false,
  className,
}: {
  idea: IdeaOnMap;
  asOf: string;
  layers: Layers;
  onLayers: (next: Layers) => void;
  /** The gallery draws the fold of further evidence open. */
  moreOpen?: boolean;
  className?: string;
}) {
  const answer = answerLine(idea.stateRow, new Date(asOf));
  const shown = idea.evidence.slice(0, CARD_EVIDENCE_LIMIT);
  const rest = idea.evidence.slice(CARD_EVIDENCE_LIMIT);
  const near = idea.strength <= 0 && idea.haze > 0.05;
  const nothing = !answer && idea.evidence.length === 0 && !near;
  const practice = idea.track ? practiceHref({ track: idea.track.id }) : null;

  return (
    <section className={className} aria-label="Why it is lit">
      <h3 className="text-ui font-semibold text-ink">
        {nothing ? 'Why it is not lit' : 'Why it is lit'}
      </h3>
      {nothing ? (
        <p className="mt-0.5 text-ui text-ink-muted">
          Nothing has lit it yet. A question about it would, and so would a course, a note or work
          that touches it.
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {answer && (
            <li className="flex items-start gap-2 text-ui text-ink">
              <CircleCheck
                className="mt-0.5 size-4 shrink-0 text-ink-muted"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block break-words">{answer.line}</span>
                {answer.fades && (
                  <span className="block text-small text-ink-muted">{answer.fades}</span>
                )}
              </span>
            </li>
          )}
          {shown.map(item)}
        </ul>
      )}
      {rest.length > 0 && (
        <Disclosure
          title={`${rest.length} more`}
          className="mt-1"
          defaultOpen={moreOpen}
          bodyClassName="mt-1 pl-0"
        >
          <ul className="space-y-1.5">{rest.map(item)}</ul>
        </Disclosure>
      )}
      {idea.strength <= 0 && idea.evidence.length > 0 && (
        <p className="mt-1.5 text-small text-ink-muted">
          These rings do not fade. A question about it would trade them for brightness, which does.
        </p>
      )}
      {near && (
        <p className="mt-1.5 text-small text-ink-muted">
          It glows faintly because topics near it are ones you have been tested on.
        </p>
      )}
      {practice && (
        <Link
          href={practice}
          className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'mt-3')}
        >
          Re-check its subject now
        </Link>
      )}
      <LayerSwitch layers={layers} onChange={onLayers} className="mt-4" />
    </section>
  );
}

/**
 * Why a subject's topic stands where it does, for the topic open in a
 * territory: the levels held, tested and held without a test apart, and what
 * holds the highest, the words of the answer (folded until asked for), when
 * it falls due a re-check, what you are ready for on it, what it needs and
 * what needs it, the notes, courses and work that touched it (plan #2317.2)
 * and your ideas under it. With nothing held it says so, and what would
 * change that.
 */
export function TopicWhy({
  territory,
  topicId,
  star,
  asOf,
  layers,
  onLayers,
  holdQuote = false,
}: {
  territory: SkyTerritory;
  topicId: string;
  /** The topic as the sky draws it, with its evidence and the ideas under it, where it is on the sky. */
  star?: IdeaOnMap;
  asOf: string;
  layers: Layers;
  onLayers: (next: Layers) => void;
  /** The gallery draws the quote open, as a tap would. */
  holdQuote?: boolean;
}) {
  const topic = territory.topics.find((t) => t.id === topicId);
  if (!topic) return null;
  const standing: TerritoryStanding | undefined = territory.standing?.find(
    (s) => s.topicId === topicId,
  );
  const ready = (territory.ready ?? []).filter((cell) => cell.topicId === topicId);
  const next = ready[0];
  const { needs, neededBy } = requirementsOf(territory, topicId);
  const recheck = standing ? practiceHref({ cell: standing.cellId }) : null;
  const met = star?.evidence ?? [];

  return (
    <>
      <Card padding="standard">
        <h2 className="text-body font-medium text-ink">{topic.name}</h2>
        <p className="tabular text-small text-ink-muted">
          {`${topic.held > 0 ? 'Level ' : ''}${levelsText({ held: topic.held, tested: topic.tested, ceiling: topic.ceiling })}`}
          {topic.target === null ? ', no target in this subject' : `, target ${topic.target}`}
        </p>

        <h3 className="mt-3 text-ui font-semibold text-ink">
          {standing ? 'Why it is lit' : 'Why it is not lit'}
        </h3>
        {standing ? (
          <>
            <p className="mt-0.5 text-ui text-ink">{standingText(standing)}</p>
            {standing.quote && (
              <Disclosure
                title={quoteLabel(standing)}
                className="mt-1"
                defaultOpen={holdQuote}
                bodyClassName="mt-1 pl-0"
              >
                <blockquote className="border-l-2 border-border-strong pl-3 text-ui break-words text-ink">
                  {standing.quote}
                </blockquote>
              </Disclosure>
            )}
            <p className="mt-1 text-small text-ink-muted">{dueText(standing, new Date(asOf))}</p>
            {recheck && (
              <Link
                href={recheck}
                className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'mt-3')}
              >
                Re-check level {standing.level} now
              </Link>
            )}
          </>
        ) : (
          <p className="mt-0.5 text-ui text-ink-muted">
            {layers.answers
              ? 'Nothing is held on it yet, so no answer has lit it. One answer at its first level would.'
              : 'Answers are off, so the levels you hold are not drawn.'}
          </p>
        )}

        {next && (
          <>
            <h3 className="mt-4 text-ui font-semibold text-ink">Ready for</h3>
            <p className="mt-0.5 text-ui text-ink">
              Level {next.level}
              {next.why ? `. ${next.why}` : ''}
            </p>
            {!standing && (
              <Link
                href={practiceHref({ cell: next.cellId })}
                className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'mt-3')}
              >
                Ask about level {next.level}
              </Link>
            )}
          </>
        )}

        {needs.length > 0 && (
          <>
            <h3 className="mt-4 text-ui font-semibold text-ink">It needs</h3>
            <ul className="divide-y divide-border">
              {needs.map((n) =>
                requirementRow(n, `${n.name} at level ${n.at}`, `for its level ${n.level}`),
              )}
            </ul>
          </>
        )}
        {neededBy.length > 0 && (
          <>
            <h3 className="mt-4 text-ui font-semibold text-ink">Needed by</h3>
            <ul className="divide-y divide-border">
              {neededBy.map((n) =>
                requirementRow(n, n.name, `at its level ${n.at}, for this level ${n.level}`),
              )}
            </ul>
          </>
        )}

        {met.length > 0 && (
          <>
            <h3 className="mt-4 text-ui font-semibold text-ink">Met in your notes, courses and work</h3>
            <ul className="mt-1.5 space-y-1.5">{met.slice(0, CARD_EVIDENCE_LIMIT).map(item)}</ul>
            {met.length > CARD_EVIDENCE_LIMIT && (
              <Disclosure title={`${met.length - CARD_EVIDENCE_LIMIT} more`} className="mt-1" bodyClassName="mt-1 pl-0">
                <ul className="space-y-1.5">{met.slice(CARD_EVIDENCE_LIMIT).map(item)}</ul>
              </Disclosure>
            )}
          </>
        )}

        <IdeasUnder ideas={star?.ideasUnder} className="mt-4" />
      </Card>
      <Card padding="standard">
        <LayerSwitch layers={layers} onChange={onLayers} />
      </Card>
    </>
  );
}

function requirementRow(n: { name: string; level: number }, main: string, aside: string) {
  return (
    <li key={`${n.name}:${n.level}:${aside}`} className="py-1.5 text-ui text-ink">
      <span className="block break-words">{main}</span>
      <span className="block text-small text-ink-muted">{aside}</span>
    </li>
  );
}
