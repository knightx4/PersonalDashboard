import { FileText, Paperclip } from 'lucide-react';
import { cn } from '@/lib/cn';
import { attachmentSize, isImageAttachment } from '@/lib/attachments/rules';

/**
 * The files a todo holds (plan #1714): a picture as a thumbnail, anything
 * else as a chip with its name and size. Each opens at full size in a new
 * tab, through /attachments/<id>, which signs a short link to it.
 *
 * Named for the todo rather than as a general list, since the attachments
 * feature's other places draw their own (#1713 builds attachment-list.tsx).
 */

/** One file as the row is handed it: what store.ts's Attachment carries, less the paths. */
export type TaskFile = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  href: string;
};

/** The paperclip and the count, beside the title. A button when it opens the list. */
export function TaskFilesCount({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  const label = count === 1 ? '1 file' : `${count} files`;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? `Hide ${label}` : `Show ${label}`}
      className={cn(
        'press press-area inline-flex items-center gap-0.5 rounded-control text-small tabular-nums transition-colors duration-quick',
        open ? 'text-accent' : 'text-ink-muted hover:text-accent',
      )}
    >
      <Paperclip className="size-3" strokeWidth={1.75} aria-hidden />
      {count}
    </button>
  );
}

/** The files themselves, under the row. */
export function TaskFiles({ files, className }: { files: readonly TaskFile[]; className?: string }) {
  if (files.length === 0) return null;
  const pictures = files.filter((file) => isImageAttachment(file.contentType));
  const others = files.filter((file) => !isImageAttachment(file.contentType));
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {pictures.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Pictures">
          {pictures.map((file) => (
            <li key={file.id}>
              <a
                href={file.href}
                target="_blank"
                rel="noreferrer"
                title={file.name}
                className="press block size-20 overflow-hidden rounded-control border border-border bg-sunken" /* ui-ok: the edge of a photo, which keeps a white page apart from the surface; it groups nothing */
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={file.href} alt={file.name} loading="lazy" className="size-full object-cover" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Files">
          {others.map((file) => (
            <li key={file.id} className="min-w-0 max-w-full">
              <a
                href={file.href}
                target="_blank"
                rel="noreferrer"
                className="press press-area flex min-w-0 items-center gap-1.5 rounded-control bg-sunken px-2 py-1 text-small text-ink transition-colors duration-quick hover:text-accent"
              >
                <FileText className="size-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
                <span className="min-w-0 truncate">{file.name}</span>
                <span className="shrink-0 text-ink-muted">{attachmentSize(file.size)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
