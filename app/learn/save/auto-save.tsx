'use client';

import { startTransition, useActionState, useEffect, useRef } from 'react';
import { saveReadingLink, type SaveLinkState } from './actions';
import { SaveLinkResult } from './save-link-form';

/**
 * Saves what a share sheet or bookmarklet sent as soon as the page opens, so
 * sharing a link to Dash is the whole job. Runs once per page load.
 */
export function AutoSave({ url, text }: { url: string; text: string }) {
  const [state, formAction, pending] = useActionState<SaveLinkState, FormData>(saveReadingLink, { status: 'idle' });
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const data = new FormData();
    data.set('url', url);
    data.set('text', text);
    startTransition(() => formAction(data));
  }, [url, text, formAction]);

  if (pending || state.status === 'idle') {
    return (
      <p className="text-ui text-ink-muted" role="status">
        Saving…
      </p>
    );
  }
  return <SaveLinkResult state={state} />;
}
