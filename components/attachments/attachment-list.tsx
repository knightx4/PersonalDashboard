import { FileText } from 'lucide-react';
import type { Attachment } from '@/lib/attachments/store';
import { attachmentSize, isImageAttachment } from '@/lib/attachments/rules';
import { cn } from '@/lib/cn';

/** What the list needs of a recorded file: lib/attachments/store.ts reads it. */
export type AttachmentListItem = Pick<Attachment, 'id' | 'name' | 'contentType' | 'size' | 'href'>;

/**
 * The files a row holds, wherever the row is shown (plan #1713, feature
 * #1711): a picture as a thumbnail, anything else as a chip with its name
 * and size. Each opens at full size in a new tab, through the short signed
 * link `href` names (app/attachments/[id]/route.ts), so a PDF or a Word file
 * opens the same way a picture does.
 *
 * Pictures first and then the rest, each in the order they were added, so a
 * row with a screenshot and a PDF reads as the screenshot with something
 * beside it. Draws nothing for an empty list, so a caller passes whatever it
 * has.
 */
export function AttachmentList({
  files,
  className,
}: {
  files: readonly AttachmentListItem[];
  className?: string;
}) {
  if (files.length === 0) return null;
  const pictures = files.filter((file) => isImageAttachment(file.contentType));
  const others = files.filter((file) => !isImageAttachment(file.contentType));

  return (
    <ul className={cn('flex flex-wrap items-center gap-2', className)} aria-label="Files">
      {pictures.map((file) => (
        <li key={file.id}>
          <a
            href={file.href}
            target="_blank"
            rel="noopener noreferrer"
            title={file.name}
            aria-label={`Open ${file.name} at full size`}
            className="press block size-20 overflow-hidden rounded-control bg-sunken hover:opacity-85"
          >
            {/* A plain img: the source is a redirect to a link that expires,
                which next/image would try to cache. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={file.href}
              alt={file.name}
              loading="lazy"
              className="size-full object-cover"
            />
          </a>
        </li>
      ))}
      {others.map((file) => (
        <li key={file.id} className="min-w-0 max-w-full">
          <a
            href={file.href}
            target="_blank"
            rel="noopener noreferrer"
            className="press press-area flex min-w-0 items-center gap-1.5 rounded-control bg-sunken px-2 py-1 text-small text-ink hover:text-accent"
          >
            <FileText aria-hidden className="size-4 shrink-0 text-ink-muted" />
            <span className="min-w-0 truncate">{file.name}</span>
            <span className="shrink-0 text-ink-muted">{attachmentSize(file.size)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
