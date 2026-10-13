import Link from '@/components/ui/link';
import { ChevronRight, FileText } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { fileHref, isUnread, type FileAuthor } from '@/lib/files/files';
import { DashCredit } from '@/components/ui/dash-mark';

type FileLinkItem = {
  fileId: string;
  title: string;
  summary: string | null;
  meta?: string;
  /** Dash wrote it: the meta line opens with Dash's mark (plan #1338). */
  byDash?: boolean;
  /** Not opened since Dash wrote this version (plan #1861): a dot before the title. */
  unread?: boolean;
  /** Or who wrote it and when it was read, from which `unread` is worked out. */
  madeBy?: FileAuthor;
  readAt?: string | null;
};

/**
 * Files as rows that open them: the title, its summary under it, and an
 * optional line of when or who. One not read yet has a dot before its title,
 * in ink rather than a colour, since having read something is not one of the
 * things colour may say. `bare` leaves out the card, for a list that already
 * sits inside one, such as a step's result.
 */
export function FileLinks({ files, bare = false }: { files: FileLinkItem[]; bare?: boolean }) {
  const list = (
    <ul className="divide-y divide-border">
      {files.map((file) => (
        <li key={file.fileId}>
          <Link
            href={fileHref(file.fileId)}
            className="card-pad-x row-pad flex items-start gap-3 transition-colors duration-quick hover:bg-sunken"
          >
            <FileText className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-ui font-medium text-ink">
                {(file.unread ?? isUnread(file)) && (
                  <span
                    title="Not read yet"
                    className="mr-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-ink align-middle"
                  >
                    <span className="sr-only">Not read yet: </span>
                  </span>
                )}
                {file.title}
              </span>
              {file.summary && <span className="mt-0.5 block text-small text-ink-muted">{file.summary}</span>}
              {file.meta && (
                <span className="mt-0.5 block text-small text-ink-muted">
                  {file.byDash && <DashCredit />}
                  {file.meta}
                </span>
              )}
            </span>
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
  return bare ? list : <Card>{list}</Card>;
}
