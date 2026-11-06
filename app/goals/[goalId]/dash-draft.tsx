'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { FileBody } from '@/components/files/file-body';
import { FileLinks } from '@/components/files/file-links';
import { Button, buttonVariants } from '@/components/ui/button';
import { DashCredit } from '@/components/ui/dash-mark';
import { Disclosure } from '@/components/ui/disclosure';
import type { LinkedFile } from '@/lib/files/files';
import { firstSentence } from '@/lib/goals/goal-page';
import { firstLink } from '@/lib/goals/result-links';
import { readResultAction } from './shaping-actions';

/** "transalt.org/volunteer" for https://www.transalt.org/volunteer/, to name a link by where it goes. */
function placeOf(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    const path = pathname.replace(/\/+$/, '');
    return `${hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return url;
  }
}

/** Copy, then Copied for a moment once the text is on the clipboard. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setCopied(false), 1800);
          },
          () => setCopied(false),
        )
      }
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

/**
 * What Dash wrote for a step, on the step's own row (plan #1078): folded to
 * its first sentence, and open to the whole text with Copy and where it
 * points. It replaces the page's separate list of what Dash found.
 *
 * On a step of yours it is Dash's draft: what a Dash step that prepares this
 * one produced (`prepares_id`), or what Ask Dash prepared on the step itself.
 * On a Dash step it is what the step found.
 *
 * Opening it is reading it. When the text is a Dash step's result still
 * unread, opening the fold marks that step read (`readId`), the write Mark
 * read made. The page is not read again then, so the row stays where it was
 * opened until the next visit.
 */
export function DashDraft({
  label,
  markdown,
  url = null,
  files = [],
  readId = null,
  inset,
  defaultOpen = false,
  summary = true,
  aside = false,
}: {
  /** "Dash’s draft" on a step of yours, "Dash found" on Dash's own. */
  label: string;
  markdown: string | null;
  url?: string | null;
  files?: LinkedFile[];
  /** The Dash step to mark read when this is opened, while its result is unread. */
  readId?: string | null;
  inset: React.CSSProperties;
  /** Start open. A seam for the gallery; nothing in the app passes it. */
  defaultOpen?: boolean;
  /** Follow the label with the draft's first sentence; the Plan tab's cards show the label alone. */
  summary?: boolean;
  /**
   * Drawn as an aside inside a step's card (the Plan tab): the label a small
   * semibold one in the goal's colour, the text the muted 13px of an aside.
   */
  aside?: boolean;
}) {
  const marked = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const fact = markdown ? firstSentence(markdown) : '';
  const link = url ?? (markdown ? firstLink(markdown) : null);
  return (
    <li style={inset} className="pb-1.5 pr-3">
      <Disclosure
        defaultOpen={defaultOpen}
        summaryClassName="items-baseline py-0.5 text-small"
        bodyClassName="mt-1.5 space-y-2 pl-5"
        onToggle={(open) => {
          if (!open || !readId || marked.current) return;
          marked.current = true;
          void readResultAction(readId).then((result) => {
            if (result.error) {
              marked.current = false;
              setError(result.error);
            }
          });
        }}
        title={
          <span className="font-normal break-words text-ink-muted">
            <span className={aside ? 'font-semibold text-accent' : 'font-medium text-ink'}>
              <DashCredit />
              {label}
            </span>
            {readId && <span className="text-accent"> · new</span>}
            {summary && fact && <span>: {fact}</span>}
          </span>
        }
      >
        {markdown && <FileBody markdown={markdown} compact={!aside} aside={aside} />}
        {files.length > 0 && <FileLinks files={files} />}
        <div className="flex flex-wrap items-center gap-2">
          {markdown && <CopyButton text={markdown} />}
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              <ExternalLink strokeWidth={1.75} className="size-3.5" aria-hidden />
              Open {placeOf(link)}
            </a>
          )}
          {error && <span className="text-small text-danger">{error}</span>}
        </div>
      </Disclosure>
    </li>
  );
}
