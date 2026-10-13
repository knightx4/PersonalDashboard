import { FileText } from 'lucide-react';
import { FileLinks } from '@/components/files/file-links';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { authorLine, isUnread } from '@/lib/files/files';
import { loadFiles } from '@/lib/files/store';
import { formatInstant } from '@/lib/goals/dates';

export const metadata = { title: 'Files' };
export const dynamic = 'force-dynamic';

/**
 * Every file, most recently changed first (supabase/migrations/0105). A file
 * is a longer piece kept as its own page, usually written by a run for a goal
 * step and linked from it; this is where they can all be found again once the
 * step is done. The ones still to read come first, under their own heading
 * (note 29321f82): Dash's files whose newest version you have not opened
 * (core.files.read_at, plan #1861).
 */
export default async function FilesPage() {
  const user = await requireUser();
  const [account, core] = await Promise.all([loadAccountSettings(user.id), createCoreClient()]);
  const files = await loadFiles(core);
  const toRead = files.filter(isUnread);
  const rest = files.filter((file) => !isUnread(file));
  const links = (list: typeof files) =>
    list.map((file) => ({
      fileId: file.id,
      title: file.title,
      summary: file.summary,
      meta: `${authorLine(file)} · ${formatInstant(file.updatedAt, account.timezone)}`,
      byDash: file.madeBy === 'claude',
      unread: isUnread(file),
    }));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Files" description="Longer pieces Dash wrote for your goals, kept as pages." />
      {files.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No files yet"
          description="When Dash works a step that needs more than a few lines, what it writes is kept here and linked from the step."
        />
      ) : toRead.length === 0 ? (
        <FileLinks files={links(rest)} />
      ) : (
        <div className="space-y-6">
          <section aria-labelledby="files-to-read" className="space-y-2">
            <h2 id="files-to-read" className="px-1 text-ui font-semibold text-ink">
              To read <span className="font-normal text-ink-muted">{toRead.length}</span>
            </h2>
            <FileLinks files={links(toRead)} />
          </section>
          {rest.length > 0 && (
            <section aria-labelledby="files-rest" className="space-y-2">
              <h2 id="files-rest" className="px-1 text-ui font-semibold text-ink">
                The rest
              </h2>
              <FileLinks files={links(rest)} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
