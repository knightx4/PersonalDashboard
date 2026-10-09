import { FileText } from 'lucide-react';
import { attachmentSize, isImageAttachment } from '@/lib/attachments/rules';

/**
 * The files sent with a question, under the person's words in the chat (plan
 * #1715): a picture as a small thumbnail that opens it, anything else as a
 * chip with its name and size. `href` opens the file through a short signed
 * link (GET /attachments/<id>); a file still going up has none, and shows as
 * a plain chip.
 */
export type AskTurnFile = { id?: string; name: string; contentType: string; size: number; href?: string };

export function AskTurnFiles({ files }: { files: readonly AskTurnFile[] }) {
  if (files.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 pt-1" aria-label="Sent with this question">
      {files.map((file, index) => {
        const key = file.id ?? `${file.name}-${index}`;
        if (file.href && isImageAttachment(file.contentType)) {
          return (
            <li key={key}>
              <a
                href={file.href}
                target="_blank"
                rel="noopener noreferrer"
                className="press-area block overflow-hidden rounded-control bg-sunken"
                title={file.name}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a signed, private link; next/image cannot optimise it */}
                <img src={file.href} alt={file.name} className="size-16 object-cover" />
              </a>
            </li>
          );
        }
        const chip = (
          <>
            <FileText aria-hidden className="size-3.5 shrink-0 text-ink-muted" strokeWidth={2} />
            <span className="min-w-0 truncate">{file.name}</span>
            <span className="shrink-0 text-ink-muted">{attachmentSize(file.size)}</span>
          </>
        );
        const style = 'flex min-w-0 max-w-full items-center gap-1 rounded-control bg-sunken px-2 py-0.5 text-small text-ink';
        return (
          <li key={key} className="min-w-0 max-w-full">
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
