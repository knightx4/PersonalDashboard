import { FileText } from 'lucide-react';
import { chipVariants } from '@/components/ui/chip';
import { cn } from '@/lib/cn';
import { attachmentSize, isImageAttachment } from '@/lib/attachments/rules';

/**
 * The files sent with a question, under the person's words in the chat (plan
 * #1715): a picture as a small thumbnail that opens it, anything else as a
 * a chip with its name and size. `href` opens the file through a short signed
 * link (GET /attachments/<id>); a file still going up has none, and shows as
 * a plain chip.
 *
 * A message on People (plan #2974) draws its pictures `large`, as a texting
 * app does, on the sender's side (`align="end"` for the person's own). A
 * wide one, such as a chart a bot's code made (plan #3050.3.1), is held
 * inside the phone's width.
 */
export type AskTurnFile = { id?: string; name: string; contentType: string; size: number; href?: string };

export function AskTurnFiles({
  files,
  large = false,
  align = 'start',
  label = 'Sent with this question',
}: {
  files: readonly AskTurnFile[];
  large?: boolean;
  align?: 'start' | 'end';
  label?: string;
}) {
  if (files.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap gap-1.5', large ? 'py-0.5' : 'pt-1', align === 'end' && 'justify-end')} aria-label={label}>
      {files.map((file, index) => {
        const key = file.id ?? `${file.name}-${index}`;
        if (file.href && isImageAttachment(file.contentType)) {
          return (
            <li key={key}>
              <a
                href={file.href}
                target="_blank"
                rel="noopener noreferrer"
                className="press-area block overflow-hidden rounded-card bg-sunken"
                title={file.name}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a signed, private link; next/image cannot optimise it */}
                <img
                  src={file.href}
                  alt={file.name}
                  className={large ? 'max-h-60 w-auto max-w-xs object-contain sm:max-w-72' : 'size-16 object-cover'}
                />
              </a>
            </li>
          );
        }
        const chip = (
          <>
            <FileText aria-hidden className="size-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} />
            <span className="min-w-0 truncate">{file.name}</span>
            <span className="shrink-0 text-ink-muted">{attachmentSize(file.size)}</span>
          </>
        );
        const style = `${chipVariants({ size: 'md' })} min-w-0 max-w-full text-ink`;
        return (
          <li key={key} className={cn('min-w-0 max-w-full', large && 'max-sm:max-w-xs')}>
            {file.href ? (
              <a
                href={file.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`${style} press-area hover:bg-surface`}
              >
                {chip}
              </a>
            ) : (
              <span className={style}>{chip}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
