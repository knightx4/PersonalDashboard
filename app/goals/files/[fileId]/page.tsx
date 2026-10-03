import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Flag, ListTree } from 'lucide-react';
import { FileBody } from '@/components/files/file-body';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { authorLine, fileHref, fileVersionHref, parseVersion } from '@/lib/files/files';
import { loadFile, loadFileThread, loadVersionBody, loadVersions } from '@/lib/files/store';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { formatInstant } from '@/lib/goals/dates';
import { loadFileUses, type FileUse } from '@/lib/goals/files-store';
import type { DevComment } from '@/lib/comments/load';
import { Thread } from '@/components/thread/thread';
import { threadRef } from '@/lib/thread/subjects';
import { MarkFileRead } from './mark-read';
import { DashCredit } from '@/components/ui/dash-mark';

export const metadata = { title: 'File' };
export const dynamic = 'force-dynamic';

/**
 * One file, to read (supabase/migrations/0105): its title, who wrote it and
 * when, the body, the goals and steps that link to it, and every earlier
 * version. `?v=2` shows version 2, with a line saying it is not the newest.
 * Under the body, a thread of your comments on it (note 7a6a37aa).
 */
export default async function FilePage({
  params,
  searchParams,
}: {
  params: Promise<{ fileId: string }>;
  searchParams: Promise<{ v?: string | string[] }>;
}) {
  const [{ fileId }, query] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) notFound();

  const user = await requireUser();
  const [account, core, goals] = await Promise.all([
    loadAccountSettings(user.id),
    createCoreClient(),
    createGoalsClient(),
  ]);
  const file = await loadFile(core, fileId);
  if (!file) notFound();

  const asked = parseVersion(query.v);
  const [versions, uses, thread, older] = await Promise.all([
    loadVersions(core, fileId),
    // A failed read leaves "Linked from" out rather than the file.
    loadFileUses(goals, fileId).catch((): FileUse[] => []),
    // Likewise the thread: a failed read leaves it empty, not the page broken.
    loadFileThread(core, fileId).catch((): DevComment[] => []),
    asked !== null && asked !== file.version ? loadVersionBody(core, fileId, asked) : null,
  ]);
  if (asked !== null && asked !== file.version && !older) notFound();

  const shown = older ?? { title: file.title, body: file.body };
  const earlier = versions.filter((version) => version.version !== file.version);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/goals/files"
        className="mb-3 inline-flex items-center gap-1.5 text-ui text-ink-muted transition-colors duration-quick hover:text-ink"
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden /> Files
      </Link>
      <PageHeader
        title={shown.title}
        description={
          <>
            {file.madeBy === 'claude' && <DashCredit />}
            {`${authorLine(file)} · updated ${formatInstant(file.updatedAt, account.timezone)}`}
          </>
        }
      />
      <div className="space-y-6">
        {older && (
          <Banner tone="info">
            <p className="text-small text-ink">
              This is version {asked}.{' '}
              <Link href={fileHref(file.id)} className="underline underline-offset-2">
                Read the newest, version {file.version}
              </Link>
              .
            </p>
          </Banner>
        )}
        <Card padding="standard">
          <FileBody markdown={shown.body} />
        </Card>
        {/* Reading the newest version is reading the results that link to it. */}
        {!older && (
          <MarkFileRead
            stepIds={uses.filter((use) => use.level === 'step').map((use) => use.itemId)}
          />
        )}

        {/* Notes on the file (note 7a6a37aa), read by the goals run before it revises it;
            one tagged @dash is answered in the thread, from the file (plan #1441). */}
        <section aria-label="Comments" className="px-1">
          <Thread
            subject={threadRef('file', file.id)}
            turns={thread}
            placeholder="What you think of this file, or what it should change."
          />
        </section>

        {uses.length > 0 && (
          <section aria-labelledby="uses-heading" className="space-y-2">
            <h2 id="uses-heading" className="px-1 text-ui font-semibold text-ink">
              Linked from
            </h2>
            <Card>
              <ul className="divide-y divide-border">
                {uses.map((use) => (
                  <li key={use.itemId}>
                    <Link
                      href={
                        use.level === 'goal'
                          ? `/goals/${use.goalId}`
                          : `/goals/${use.goalId}#step-${use.itemId}`
                      }
                      className="card-pad-x row-pad flex items-start gap-3 transition-colors duration-quick hover:bg-sunken"
                    >
                      {use.level === 'goal' ? (
                        <Flag
                          className="mt-0.5 size-4 shrink-0 text-ink-muted"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                      ) : (
                        <ListTree
                          className="mt-0.5 size-4 shrink-0 text-ink-muted"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0 flex-1 text-ui text-ink">
                        {use.title}
                        <span className="block text-small text-ink-muted">
                          {use.level === 'goal' ? 'Goal' : 'Step'}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        {earlier.length > 0 && (
          <SectionFold title="Earlier versions" count={earlier.length} defaultOpen={false}>
            <Card>
              <ul className="divide-y divide-border">
                {earlier.map((version) => (
                  <li key={version.version}>
                    <Link
                      href={fileVersionHref(file.id, version.version)}
                      className="card-pad-x row-pad block transition-colors duration-quick hover:bg-sunken"
                    >
                      <span className="block text-ui text-ink">
                        Version {version.version} ·{' '}
                        {formatInstant(version.createdAt, account.timezone)}
                      </span>
                      {version.changeNote && (
                        <span className="mt-0.5 block text-small text-ink-muted">
                          {version.changeNote}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </SectionFold>
        )}
        {!older && file.changeNote && (
          <p className="px-1 text-small text-ink-muted">
            What changed in this version: {file.changeNote}
          </p>
        )}
      </div>
    </div>
  );
}
