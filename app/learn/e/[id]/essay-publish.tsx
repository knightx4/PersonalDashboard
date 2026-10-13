'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { essayAddress } from '@/lib/learn/essays/address';
import { unpublishEssay, type PublishResult, type UnpublishResult } from './actions';
import { linkVariants } from '@/components/ui/link';
import { cn } from '@/lib/cn';

/**
 * Publish (plan #1863.11; spec, "Finishing and publishing"). One press saves
 * the essay to the vault and copies it into the snapshot selveyknight.com
 * reads; edits after that stay here until the next press. Only a finished
 * essay can be published. Unpublish takes the snapshot away and leaves the
 * vault note as it is.
 */

/** Where the card has got to. Exported so the gallery can draw a state. */
export type PublishView =
  | { kind: 'idle' }
  | { kind: 'publishing' }
  | { kind: 'unpublishing' }
  | { kind: 'failed'; error: string };

/** The site's address, as the card names it. */
export const SITE = 'selveyknight.com';

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The line saying where the essay stands on the site. */
export function publishLine(state: {
  finished: boolean;
  publishedAt: string | null;
  firstPublishedAt: string | null;
}): string {
  if (state.publishedAt) {
    const first = state.firstPublishedAt ?? state.publishedAt;
    const since = `Published since ${when(first)}.`;
    return when(first) === when(state.publishedAt) ? since : `${since} Last published ${when(state.publishedAt)}.`;
  }
  if (!state.finished) return `Finish the essay first. Only a finished essay goes on ${SITE}.`;
  return `Puts this version on ${SITE}. Edits after that stay here until you publish again.`;
}

export function EssayPublishCard({
  essayId,
  finished,
  publishedAt,
  firstPublishedAt,
  slug,
  canPublish,
  onPublish,
  initial = { kind: 'idle' },
  className,
}: {
  essayId: string;
  /** True once Finish has run; a draft is never published. */
  finished: boolean;
  publishedAt: string | null;
  firstPublishedAt: string | null;
  slug: string | null;
  /** False while the essay is empty or a vault save is running. */
  canPublish: boolean;
  /** Saves and publishes through the editor's save queue. */
  onPublish: () => Promise<PublishResult | { ok: false; error: string }>;
  initial?: PublishView;
  className?: string;
}) {
  const [view, setView] = useState<PublishView>(initial);
  const [state, setState] = useState({ publishedAt, firstPublishedAt, slug });

  const publish = useCallback(async () => {
    setView({ kind: 'publishing' });
    const result = await onPublish();
    if (!result.ok) {
      // A failed vault save is explained under the editor.
      setView('reason' in result && result.reason ? { kind: 'idle' } : { kind: 'failed', error: result.error });
      return;
    }
    setState({ publishedAt: result.publishedAt, firstPublishedAt: result.firstPublishedAt, slug: result.slug });
    setView({ kind: 'idle' });
  }, [onPublish]);

  const unpublish = useCallback(async () => {
    setView({ kind: 'unpublishing' });
    let result: UnpublishResult;
    try {
      result = await unpublishEssay(essayId);
    } catch {
      result = { ok: false, error: 'The connection dropped. Try again in a moment.' };
    }
    if (!result.ok) {
      setView({ kind: 'failed', error: result.error });
      return;
    }
    setState((now) => ({ ...now, publishedAt: null }));
    setView({ kind: 'idle' });
  }, [essayId]);

  const busy = view.kind === 'publishing' || view.kind === 'unpublishing';
  const live = state.publishedAt !== null;

  return (
    <Card padding="none" className={className}>
      <CardSection title="Publish">
        <p className="text-small text-ink-muted">
          {publishLine({ finished, publishedAt: state.publishedAt, firstPublishedAt: state.firstPublishedAt })}
        </p>
        {live && state.slug && (
          <p className="mt-1 text-ui [overflow-wrap:anywhere]">
            <a
              href={`https://${SITE}${essayAddress(state.slug)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={cn('flex min-h-11 items-center', linkVariants())}
            >
              {SITE}
              {essayAddress(state.slug)}
            </a>
          </p>
        )}
        {!live && finished && (
          <p className="mt-1 text-small text-ink-muted">
            Links to your own notes show there as plain text, and who wrote which words is left out.
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          {live && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              pending={view.kind === 'unpublishing'}
              onClick={() => void unpublish()}
            >
              {view.kind === 'unpublishing' ? 'Unpublishing…' : 'Unpublish'}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!finished || !canPublish || busy}
            pending={view.kind === 'publishing'}
            onClick={() => void publish()}
          >
            {view.kind === 'publishing' ? 'Publishing…' : live ? 'Publish again' : 'Publish'}
          </Button>
        </div>
        {view.kind === 'failed' && (
          <p role="alert" className="mt-3 text-small text-danger">
            {view.error}
          </p>
        )}
      </CardSection>
    </Card>
  );
}
