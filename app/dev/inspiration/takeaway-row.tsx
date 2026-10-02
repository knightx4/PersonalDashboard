import Link from 'next/link';
import { ModuleMark } from '@/components/ui/module-mark';
import { StateLabel } from '@/components/dev/state-label';
import { MODULES, type ModuleId } from '@/lib/modules';
import { ideaScoreView } from '@/lib/ideas/score';
import { clockTime } from '@/lib/learn/youtube/format';
import { cn } from '@/lib/cn';
import { planHref } from '@/lib/search/sources/dev-map';
import type { Takeaway, TakeawaySource } from '@/lib/dev/inspiration/view';
import { TakeawayActions } from './takeaway-actions';

/**
 * One takeaway, drawn the same way in both views (plan #1412).
 *
 * `inVideo` is the by-video view, where the video is already the heading
 * above: the row then quotes what that video said and links to the moment,
 * without naming the video again. In the one-list view every video the point
 * came from is named under it, each with its own moment.
 *
 * A server component with no state; the buttons that act on a takeaway
 * (#1413) are the client component in the footer, takeaway-actions.tsx.
 */

const MODULE_LABEL = new Map<ModuleId, string>(MODULES.map((module) => [module.id, module.label]));

function WorkspaceChip({ module }: { module: ModuleId | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-tint py-0.5 pl-1 pr-2 text-micro font-semibold uppercase tracking-wide text-accent">
      <ModuleMark module={module} size="xs" className="-my-0.5" />
      {module ? (MODULE_LABEL.get(module) ?? module) : 'Everything'}
    </span>
  );
}

/** Where it already stands, or nothing for an open one. */
function TakeawayState({ takeaway }: { takeaway: Takeaway }) {
  const { cover, status } = takeaway;
  if (status === 'dismissed') return <StateLabel glyph="slash" word="Dismissed" tone="ghost" />;
  if (cover?.kind === 'plan') {
    return (
      <Link href={planHref(cover.number)} className="hover:underline">
        <StateLabel
          glyph="dashed"
          word={status === 'crafted' ? `In the plan as #${cover.number}` : `Already in the plan as #${cover.number}`}
          tone="info"
        />
      </Link>
    );
  }
  if (cover?.kind === 'idea') {
    // Crafted and linked to an idea with no feature yet: the shape routine has
    // it, and the feature number replaces this when the proposal is written.
    return (
      <Link href={`/dev/ideas#idea-${cover.ideaId}`} className="hover:underline">
        <StateLabel
          glyph="dashed"
          word={status === 'crafted' ? 'Sent to be shaped' : 'Already an idea'}
          tone="info"
        />
      </Link>
    );
  }
  return null;
}

/**
 * Jev's score, drawn as the Ideas tab draws an idea's (note 790c745a): ink
 * when sure, grey when unsure, with the long form for a screen reader.
 */
function ScoreLabel({ takeaway }: { takeaway: Takeaway }) {
  const view = ideaScoreView(takeaway.score);
  if (!takeaway.score || view.state === 'unscored') {
    return (
      <span title="Jev has not scored this takeaway yet" className="text-small text-ink-ghost">
        Unscored
      </span>
    );
  }
  return (
    <span
      title={view.title}
      className={cn('tabular text-small', view.state === 'sure' ? 'font-semibold text-ink' : 'text-ink-muted')}
    >
      <span aria-hidden>Score {Math.round(takeaway.score.value)}</span>
      <span className="sr-only">{view.title}</span>
    </span>
  );
}

/** "at 12:34", linking to that moment; "from the start" when there is none. */
function Moment({ source, label }: { source: TakeawaySource; label?: string }) {
  const at = source.startSeconds !== null ? clockTime(source.startSeconds) : null;
  return (
    <a
      href={source.href}
      target="_blank"
      rel="noreferrer"
      className="tabular font-medium text-accent hover:underline"
      title={at ? `Open the video at ${at}` : 'Open the video'}
    >
      {label ?? (at ? `Watch at ${at}` : 'Watch')}
    </a>
  );
}

function Quote({ text }: { text: string }) {
  return <q className="line-clamp-3 text-small italic text-ink-muted">{text}</q>;
}

export function TakeawayRow({ takeaway, inVideo = false }: { takeaway: Takeaway; inVideo?: boolean }) {
  const own = inVideo ? takeaway.sources[0] : undefined;
  // In a video's list the row says it in that video's words when the merge
  // kept them, since the takeaway's own wording may be another video's.
  const body = own?.said?.trim() || takeaway.body;

  return (
    <li id={`takeaway-${takeaway.id}`} className="flex scroll-mt-20 flex-col gap-1.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <WorkspaceChip module={takeaway.module} />
        <TakeawayState takeaway={takeaway} />
        <span className="ml-auto">
          <ScoreLabel takeaway={takeaway} />
        </span>
      </div>
      <h3 className="text-ui font-semibold text-ink">{takeaway.title}</h3>
      <p className="whitespace-pre-wrap text-body text-ink">{body}</p>

      {own ? (
        <div className="flex flex-col gap-0.5">
          {own.quote && <Quote text={own.quote} />}
          <span className="text-small">
            <Moment source={own} />
          </span>
        </div>
      ) : (
        takeaway.sources.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {takeaway.sources.map((source) => (
              <li key={source.videoRowId} className="flex flex-col gap-0.5">
                <span className="text-small text-ink-muted">
                  From{' '}
                  <a
                    href={source.href}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-ink hover:underline"
                  >
                    {source.videoTitle}
                  </a>
                  {source.channel && <> · {source.channel}</>}
                  {source.startSeconds !== null && (
                    <>
                      {' · '}
                      <Moment source={source} />
                    </>
                  )}
                </span>
                {source.quote && <Quote text={source.quote} />}
              </li>
            ))}
          </ul>
        )
      )}

      {takeaway.status !== 'covered' && <TakeawayActions id={takeaway.id} status={takeaway.status} />}
    </li>
  );
}
