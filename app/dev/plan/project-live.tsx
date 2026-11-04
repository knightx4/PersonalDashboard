import { Card } from '@/components/ui/card';
import { linkVariants } from '@/components/ui/link';
import { Note } from '@/components/ui/note';
import { SectionLabel } from '@/components/ui/section-heading';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusGlyph } from '@/components/ui/status-glyph';
import type { StatusGlyph as GlyphName } from '@/lib/status-glyphs';
import { cn } from '@/lib/cn';
import {
  CHECKS_SAYS,
  DEPLOY_STATE_SAYS,
  liveNotes,
  shortAgo,
  type LiveDeployState,
  type ProjectLive,
} from '@/lib/plan/project-live';
import type { CheckConclusion } from '@/lib/plan/checks';

/**
 * Whether a project's latest work is live, under its page's header (plan
 * #2800.6): main's last commit, what its checks said and its newest
 * production deploy, as a row of facts, then a sentence for anything that
 * could not be read and the failing check's detail when it failed.
 *
 * `siteUrl` is the project's own address, which "Live" links to; a project
 * with none links the deploy's own address on Vercel. `now` is the server's
 * clock at render, for the ages.
 */
export function ProjectLiveCard({
  live,
  siteUrl,
  now,
}: {
  live: ProjectLive;
  siteUrl: string | null;
  now: number;
}) {
  const { commit, checks, deploy } = live;
  const notes = liveNotes(live);
  const failed = checks?.conclusion === 'failed';

  return (
    <Card padding="dense" className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Fact label={`Last commit on ${live.branch}`} wide>
          {commit ? (
            <>
              <a
                href={commit.url}
                target="_blank"
                rel="noreferrer"
                // The area is on the link and the clipping on the text inside,
                // or the 44px press area would be cut to the line.
                className="press-area block text-ink hover:underline"
                title={commit.subject}
              >
                <span className="block truncate">{commit.subject}</span>
              </a>
              <Sub>
                {[commit.sha.slice(0, 7), shortAgo(commit.at, now)].filter(Boolean).join(' · ')}
              </Sub>
            </>
          ) : (
            <Unread />
          )}
        </Fact>
        <Fact label="Checks">
          {checks ? (
            <>
              <Word mark={CHECK_MARK[checks.conclusion]} danger={failed}>
                {CHECKS_SAYS[checks.conclusion]}
              </Word>
              {failed && checks.runUrl ? (
                <Sub>
                  <a
                    href={checks.runUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn('press-area', linkVariants({ tone: 'quiet' }))}
                  >
                    Open the run
                  </a>
                </Sub>
              ) : null}
            </>
          ) : (
            <Unread />
          )}
        </Fact>
        <Fact label="Deploy">
          {deploy ? (
            <>
              <Word mark={DEPLOY_MARK[deploy.state]} danger={deploy.state === 'failed'}>
                {DEPLOY_STATE_SAYS[deploy.state]}
              </Word>
              <DeployLink deploy={deploy} siteUrl={siteUrl} now={now} />
            </>
          ) : live.vercelProject ? (
            <Word mark={QUIET}>No deploys yet</Word>
          ) : live.deployError ? (
            <Unread />
          ) : (
            <Word mark={QUIET}>Not on Vercel</Word>
          )}
        </Fact>
      </dl>

      {failed && checks?.reason && (
        <Note tone="caution" title="Why the checks failed">
          <p className="text-small text-ink-muted">{checks.reason}</p>
        </Note>
      )}

      {notes.map((note) =>
        note.tone === 'caution' ? (
          <Note key={note.text} tone="caution">
            <p className="text-small">{note.text}</p>
          </Note>
        ) : (
          <p key={note.text} className="text-small text-ink-muted">
            {note.text}
          </p>
        ),
      )}
    </Card>
  );
}

/** The same card's shape while the reading is on its way. */
export function ProjectLiveLoading() {
  return (
    <Card padding="dense" aria-busy="true" aria-label="Reading the project's checks and deploy">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {[true, false, false].map((wide, index) => (
          <div key={index} className={cn('space-y-1.5', wide && 'col-span-2')}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className={cn('h-4', wide ? 'w-4/5' : 'w-16')} />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * The deploy's link, under its state: the site when the deploy is live, the
 * deploy's page on Vercel otherwise, where a failed build's log is.
 */
function DeployLink({
  deploy,
  siteUrl,
  now,
}: {
  deploy: NonNullable<ProjectLive['deploy']>;
  siteUrl: string | null;
  now: number;
}) {
  const ready = deploy.state === 'ready';
  const href = ready ? (siteUrl ?? deploy.url) : (deploy.inspectorUrl ?? deploy.url);
  const age = shortAgo(deploy.at, now);
  return (
    <Sub>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className={cn('press-area', linkVariants({ tone: 'quiet' }))}>
          {ready ? 'Open the site' : 'Open the deploy'}
        </a>
      ) : null}
      {href && age ? ' · ' : null}
      {age}
    </Sub>
  );
}

function Fact({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('min-w-0', wide && 'col-span-2')}>
      <SectionLabel as="dt">{label}</SectionLabel>
      <dd className="mt-0.5 min-w-0 text-ui text-ink">{children}</dd>
    </div>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <span className="tabular mt-0.5 block text-small text-ink-muted">{children}</span>;
}

/** A glyph's shape and the ink it is drawn in. */
type Mark = { glyph: GlyphName; ink: string };

/**
 * A state as a word with its glyph. The glyph's shape says the state; colour
 * is kept for what needs the person, a failure, and the rest is drawn in ink.
 */
function Word({
  mark,
  danger = false,
  children,
}: {
  mark: Mark;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <StatusGlyph glyph={mark.glyph} size={12} className={mark.ink} />
      <span className={cn('truncate', danger && 'text-danger')}>{children}</span>
    </span>
  );
}

function Unread() {
  return <Word mark={QUIET}>Not read</Word>;
}

const QUIET: Mark = { glyph: 'empty', ink: 'text-ink-ghost' };

const CHECK_MARK: Record<CheckConclusion, Mark> = {
  passed: { glyph: 'check', ink: 'text-ink-muted' },
  failed: { glyph: 'cross', ink: 'text-danger' },
  running: { glyph: 'half', ink: 'text-ink-muted' },
  none: QUIET,
  unmerged: QUIET,
};

const DEPLOY_MARK: Record<LiveDeployState, Mark> = {
  ready: { glyph: 'check', ink: 'text-ink-muted' },
  building: { glyph: 'half', ink: 'text-ink-muted' },
  failed: { glyph: 'cross', ink: 'text-danger' },
  canceled: { glyph: 'slash', ink: 'text-ink-ghost' },
};
