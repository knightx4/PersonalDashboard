'use client';

import { useActionState, useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardSection } from '@/components/ui/card';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { Field, FieldError, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import type { Feed } from '@/lib/todo/feeds/load';
import { addFeed, refreshFeedNow, removeFeed, type AgendaSettingsState } from './actions';

/**
 * The calendars you keep somewhere else.
 *
 * One way only: appointments arrive, nothing typed here is ever sent back, and
 * a subscribed appointment cannot be edited on the calendar page. The address
 * is a credential and is never drawn in full -- the host and the last few
 * characters is what tells two of them apart.
 */
export function CalendarFeeds({ feeds, timezone }: { feeds: Feed[]; timezone: string }) {
  const [state, action, pending] = useActionState<AgendaSettingsState, FormData>(addFeed, {});

  return (
    <CardSection
      title="Subscribed calendars"
      padding="standard"
      hint="Paste the private address of a calendar you already keep and its appointments appear here beside your own. Nothing you type here is ever sent back to it."
    >
      {feeds.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {feeds.map((feed) => (
            <FeedRow key={feed.id} feed={feed} timezone={timezone} />
          ))}
        </ul>
      )}

      <form action={action} className="mt-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="feed-name" label="Name" className="w-40">
            <Input id="feed-name" name="name" placeholder="Work" required maxLength={200} />
          </Field>
          <Field id="feed-address" label="Address" className="min-w-60 flex-1">
            <Input
              id="feed-address"
              name="address"
              type="url"
              inputMode="url"
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              required
            />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? 'Reading…' : 'Subscribe'}
          </Button>
        </div>

        {state.error && <FieldError>{state.error}</FieldError>}
        {state.message && <p className="text-small text-ink-muted">{state.message}</p>}
      </form>
    </CardSection>
  );
}

function FeedRow({ feed, timezone }: { feed: Feed; timezone: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState(feed.lastError);
  const toast = useToast();

  function refresh() {
    start(async () => {
      const result = await refreshFeedNow(feed.id);
      setError(result.error);
      toast({ text: result.error ?? 'read' });
    });
  }

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
      <span className="text-ui font-medium text-ink">{feed.name}</span>
      <span className="truncate text-small text-ink-muted">{feed.hint}</span>

      <span className="text-small text-ink-muted">
        {feed.lastReadAt ? `read ${when(feed.lastReadAt, timezone)}` : 'not read yet'}
      </span>

      {/* Switched off from the Calendars button on the calendar itself. Said
          here as well, because a subscription listed as though it were being
          drawn, on the page where you would come to ask why it is not, is a
          settings page that lies. */}
      {!feed.shown && <span className="text-small text-ink-ghost">hidden on the calendar</span>}

      {/* The two are shown together on purpose: the appointments on the page
          are from the last good read, and this says why there is nothing
          newer. Dropping them on a failure would be a calendar that quietly
          went empty. */}
      {error && <span className="text-small text-status-rejected">{error}</span>}

      <span className="ml-auto flex items-center gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={refresh} disabled={pending}>
          <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden />
          {pending ? 'Reading…' : 'Refresh now'}
        </Button>
        <ConfirmStep
          prompt="Removes this calendar and the appointments it brought. Nothing you typed here is touched."
          confirmLabel="Remove"
          pendingLabel="Removing…"
          onConfirm={async () => {
            const result = await removeFeed(feed.id);
            if (result.error) toast({ text: result.error });
          }}
        >
          Remove
        </ConfirmStep>
      </span>
    </li>
  );
}

/** When it was last read, in the account's own zone. */
function when(at: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(at));
}
