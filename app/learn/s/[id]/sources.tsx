'use client';

import { useEffect, useRef } from 'react';
import { ExternalLink } from 'lucide-react';
import Link, { linkVariants } from '@/components/ui/link';
import { buttonVariants } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { cn } from '@/lib/cn';
import { readFold, rememberFold } from '@/lib/fold-memory';
import { practiceHref } from '@/lib/learn/flow/href';
import type { SourceDocument } from '@/lib/learn/prepare/finish-step';
import type { StartTopicNow } from '@/lib/learn/prepare/start-load';
import type { PreparationSources } from '@/lib/learn/prepare/view';
import type { SubjectReading } from '@/lib/learn/chat/subject-load';

/**
 * What a finished preparation leaves on the subject's page (plan #2276.6).
 *
 * StartHere leads the page in place of the folded preparation line: the first
 * unit, the first topic at level 1, and the first lesson to open (plan #2292.3)
 * with a placement run beside it; Practice Flow on level 1 stays as a quiet
 * link, and is the primary press while the unit has no piece to open. A topic still a draft cannot be asked about, so until it is
 * approved the press opens the topic to approve it.
 *
 * SourcesSection sits under the curriculum: the preparation's line, every
 * document it stored with its provider, licence and link, the readings
 * already related to the subject, and the frame topics the territory refines.
 * Open the first time it is seen; once read it opens folded on later visits,
 * kept per browser like any other fold.
 */

export const SOURCES_ID = 'sources';

const LICENCE: Record<string, string> = {
  show: 'Full text',
  structure_only: 'Outline only',
  never_feed: 'Headings only',
};

/** How many readings the section names before pointing at the Reading section. */
const READINGS_SHOWN = 5;

export type StartUnit = { ordinal: number; title: string; covers: string | null };

/** The first piece not passed, where Start here opens (plan #2292.3). */
export type StartLesson = { pieceId: string; title: string };

export function StartHere({
  unit,
  topic,
  draftedName,
  subjectId,
  lesson = null,
  lessonPending = false,
}: {
  unit: StartUnit | null;
  /** The first topic as it stands now; null when it could not be read. */
  topic: StartTopicNow | null;
  /** The topic's name as the run recorded it, for when it could not be read. */
  draftedName: string | null;
  subjectId?: string;
  /** The first piece not passed; null when the unit has none or all are passed. */
  lesson?: StartLesson | null;
  /** The first unit has no pieces yet, because laying it out failed. */
  lessonPending?: boolean;
}) {
  const name = topic?.name ?? draftedName;
  if (!unit && !name) return null;
  const practise = topic?.approved && topic.cellId ? practiceHref({ cell: topic.cellId }) : null;

  return (
    <Card padding="standard" className="mb-6">
      <h2 className="text-body font-semibold text-ink">Start here</h2>
      <dl className="mt-2 space-y-2">
        {unit && (
          <div>
            <dt className="text-small text-ink-muted">First unit</dt>
            <dd className="text-body font-semibold text-ink">
              <span className="mr-1.5 text-ink-muted tabular-nums">{unit.ordinal}.</span>
              {unit.title}
            </dd>
            {unit.covers && <dd className="mt-0.5 text-ui text-ink-muted">{unit.covers}</dd>}
          </div>
        )}
        {name && (
          <div>
            <dt className="text-small text-ink-muted">First topic</dt>
            <dd className="text-body font-semibold text-ink">
              {name}
              <span className="font-normal text-ink-muted"> · level 1</span>
            </dd>
          </div>
        )}
      </dl>
      {lesson && subjectId ? (
        <>
          <p className="mt-3 text-ui text-ink-muted">
            First lesson: <span className="font-semibold text-ink">{lesson.title}</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Link href={`/learn/s/${subjectId}/p/${lesson.pieceId}`} className={buttonVariants({ variant: 'primary' })}>
              Start the first lesson
            </Link>
            <Link href={practiceHref({ track: subjectId, placement: true })} className={buttonVariants({ variant: 'secondary' })}>
              Place me first
            </Link>
            <span className="text-small text-ink-muted">About ten minutes, skip any time</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            {practise && (
              <Link href={practise} className={cn(linkVariants({ tone: 'quiet' }), '-my-3 inline-block py-3 text-ui')}>
                Practice level 1 instead
              </Link>
            )}
            <a href={`#${SOURCES_ID}`} className={cn(linkVariants({ tone: 'quiet' }), '-my-3 inline-block py-3 text-ui')}>
              Where this came from
            </a>
          </div>
        </>
      ) : (
        <>
          {lessonPending && (
            <p className="mt-3 text-ui text-ink-muted">The first lesson is being written. Dash will add it here.</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {practise ? (
              <Link href={practise} className={buttonVariants({ variant: 'primary' })}>
                Practice level 1
              </Link>
            ) : (
              topic && (
                <>
                  <Link href={`/learn/topics/${topic.id}`} className={buttonVariants({ variant: 'primary' })}>
                    Approve the topic to practice it
                  </Link>
                  <span className="text-small text-ink-muted">Its checks are drafts until you approve them.</span>
                </>
              )
            )}
            <a href={`#${SOURCES_ID}`} className={cn(linkVariants({ tone: 'quiet' }), '-my-3 inline-block py-3 text-ui')}>
              Where this came from
            </a>
          </div>
        </>
      )}
    </Card>
  );
}

function DocumentRow({ doc }: { doc: SourceDocument }) {
  // The licence as the catalogue words it, else how the bank may use the document.
  const licence = doc.rights?.trim() || (doc.licence ? (LICENCE[doc.licence] ?? doc.licence) : 'Licence not recorded');
  const units = doc.units ? `${doc.units} ${doc.units === 1 ? 'unit' : 'units'}` : null;
  const facts = [doc.provider ?? 'Already in the bank', licence, units].filter((f): f is string => Boolean(f));
  const body = (
    <>
      <span className="flex items-baseline gap-1.5 text-body text-ink group-hover/doc:text-accent">
        <span>{doc.title}</span>
        {doc.url && (
          <ExternalLink aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0 translate-y-0.5 text-ink-muted" />
        )}
      </span>
      <span className="mt-0.5 block text-small text-ink-muted">
        {facts.join(' · ')}
        {!doc.used && ' · stored, not used for the topics'}
      </span>
    </>
  );
  // The whole row is the press, so its height is the target and the title sits on its facts line.
  return (
    <li>
      {doc.url ? (
        <a href={doc.url} target="_blank" rel="noreferrer" className="group/doc card-pad block">
          {body}
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : (
        <div className="card-pad">{body}</div>
      )}
    </li>
  );
}

/** Marks the section read once half of it has been on screen, so later visits open it folded. */
function useMarkRead(remember: string, ref: React.RefObject<HTMLDivElement | null>, live: boolean) {
  useEffect(() => {
    const element = ref.current;
    if (!live || !element || typeof IntersectionObserver === 'undefined') return;
    if (readFold(remember) !== null) return;
    const seen = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          // Folded next visit, unless the reader leaves it some other way first.
          if (readFold(remember) === null) rememberFold(remember, false, true);
          seen.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    seen.observe(element);
    return () => seen.disconnect();
  }, [remember, ref, live]);

  // The Start card's link to the section opens it, on a page already drawn.
  useEffect(() => {
    const open = () => {
      if (window.location.hash !== `#${SOURCES_ID}`) return;
      const details = ref.current?.querySelector('details');
      if (details && !details.open) details.open = true;
    };
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [ref]);
}

export function SourcesSection({
  subjectId,
  sources,
  readings,
  live = true,
  defaultOpen = true,
}: {
  subjectId: string;
  sources: PreparationSources;
  readings: readonly SubjectReading[];
  /** False in the gallery, which keeps no memory of the fold. */
  live?: boolean;
  /** The gallery draws it folded, as a later visit finds it once read. */
  defaultOpen?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const remember = `learn.fold.sources.${subjectId}`;
  useMarkRead(remember, ref, live);
  const { documents, frames } = sources;
  const shownReadings = readings.slice(0, READINGS_SHOWN);

  return (
    <div id={SOURCES_ID} ref={ref} className="mt-6 scroll-mt-4">
      <SectionFold
        title="Sources"
        count={documents.length > 0 ? documents.length : undefined}
        defaultOpen={defaultOpen}
        remember={live ? remember : undefined}
      >
        {/* One panel: the preparation's line, the documents, the readings and the frames. */}
        <div className={cn(cardVariants(), 'divide-y divide-border')}>
          <p className="card-pad text-ui text-ink-muted">{sources.summary}</p>

          {documents.length === 0 ? (
            <p className="card-pad text-ui text-ink">
              No documents were stored for this subject, so its structure came from the frame topics
              and Dash&rsquo;s own reading.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {documents.map((doc, i) => (
                <DocumentRow key={doc.itemId ?? doc.url ?? i} doc={doc} />
              ))}
            </ul>
          )}

          {shownReadings.length > 0 && (
            <div className="card-pad">
              <h3 className="text-ui font-semibold text-ink-muted">Readings on this subject</h3>
              {/* Each press area is 44px tall from padding the negative margin takes back, so the gaps stay even. */}
              <ul className="mt-1 space-y-1">
                {shownReadings.map((r) => (
                  <li key={r.id} className="text-ui">
                    <Link href={`/learn/r/${r.id}`} className={linkVariants({ className: 'inline-block -my-3.5 py-3.5' })}>
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
              {readings.length > READINGS_SHOWN && (
                <p className="mt-1 text-small text-ink-muted">
                  And {readings.length - READINGS_SHOWN} more under Reading.
                </p>
              )}
            </div>
          )}

          {frames.length > 0 && (
            <div className="card-pad">
              <h3 className="text-ui font-semibold text-ink-muted">Frame topics it refines</h3>
              <p className="mt-1 text-ui text-ink">{frames.join(' · ')}</p>
            </div>
          )}
        </div>
      </SectionFold>
    </div>
  );
}
