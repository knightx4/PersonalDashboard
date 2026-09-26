import { FileText } from 'lucide-react';
import { FileLinks } from '@/components/files/file-links';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { authorLine } from '@/lib/files/files';
import { loadFiles } from '@/lib/files/store';
import { formatInstant } from '@/lib/goals/dates';

export const metadata = { title: 'Files' };
export const dynamic = 'force-dynamic';

/**
 * Every file, most recently changed first (supabase/migrations/0105). A file
 * is a longer piece kept as its own page, usually written by a run for a goal
 * step and linked from it; this is where they can all be found again once the
 * step is done.
 */
export default async function FilesPage() {
  const user = await requireUser();
  const [account, core] = await Promise.all([loadAccountSettings(user.id), createCoreClient()]);
  const files = await loadFiles(core);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Files" description="Longer pieces Dash wrote for your goals, kept as pages." />
      {files.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No files yet"
          description="When Dash works a step that needs more than a few lines, what it writes is kept here and linked from the step."
        />
      ) : (
        <FileLinks
          files={files.map((file) => ({
            fileId: file.id,
            title: file.title,
            summary: file.summary,
            meta: `${authorLine(file)} · ${formatInstant(file.updatedAt, account.timezone)}`,
          }))}
        />
      )}
    </div>
  );
}
