import Link from '@/components/ui/link';
import { AppWindow, FileText, Paperclip } from 'lucide-react';
import { attachmentSize } from '@/lib/attachments/rules';
import { cn } from '@/lib/cn';
import type { SavedAttachment } from '@/lib/talk/attached';

/**
 * The saved pages and files a bot sent with its reply by reference (plan
 * #3050.4; lib/talk/attached.ts): one card each, its title first and what it
 * is under it, the whole card opening the thing. A page or piece of writing
 * opens on its file page; a file the person added opens through its short
 * signed link, in a new tab, as the file chips do.
 *
 * Under an Ask answer the cards are as wide as the column; under a People
 * bubble they sit in the bubble's run, as a chart does.
 */

const KIND_LINE: Record<SavedAttachment['kind'], string> = {
  page: 'Page',
  writing: 'Writing',
  file: 'File',
};

function detail(card: SavedAttachment): string {
  if (card.kind !== 'file') return `${KIND_LINE[card.kind]} in your files`;
  const type = card.contentType?.split('/')[1]?.split(/[+.;]/)[0]?.toUpperCase();
  const size = typeof card.size === 'number' ? attachmentSize(card.size) : null;
  return [type && type.length <= 5 ? type : 'File', size].filter(Boolean).join(' · ');
}

function Icon({ kind }: { kind: SavedAttachment['kind'] }) {
  const Glyph = kind === 'page' ? AppWindow : kind === 'writing' ? FileText : Paperclip;
  return <Glyph aria-hidden className="size-4 shrink-0 text-ink-muted" strokeWidth={1.75} />;
}

export function AttachedCards({
  cards,
  label = 'Attached to this reply',
  className,
}: {
  cards: readonly SavedAttachment[] | undefined;
  label?: string;
  className?: string;
}) {
  if (!cards || cards.length === 0) return null;
  return (
    <ul className={cn('flex flex-col gap-1.5', className)} aria-label={label}>
      {cards.map((card) => {
        const body = (
          <>
            <Icon kind={card.kind} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ui font-medium text-ink">{card.title}</span>
              <span className="block truncate text-small text-ink-muted">{detail(card)}</span>
            </span>
          </>
        );
        const style = 'press-area flex min-h-11 w-full items-center gap-2.5 rounded-card bg-sunken px-3 py-2 hover:bg-surface';
        return (
          <li key={`${card.table}:${card.id}`} className="min-w-0">
            {card.kind === 'file' ? (
              <a href={card.href} target="_blank" rel="noopener noreferrer" className={style}>
                {body}
              </a>
            ) : (
              <Link href={card.href} className={style}>
                {body}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
