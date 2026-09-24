'use client';

import { startTransition, useActionState, useEffect, useRef } from 'react';
import { ExternalLink, RotateCw } from 'lucide-react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Group } from '@/components/ui/disclosure';
import { PaidHint } from '@/components/ui/paid-hint';
import { Skeleton } from '@/components/ui/skeleton';
import { formatArrival } from '@/lib/news/issues/list';
import { groupPicks, type NewsletterPick } from '@/lib/news/recommend/picks';
import { AddressCard } from '../settings/address-card';
import { remakeRecommendations, type RecommendState } from './actions';

const ACTION = 'app/news/all/actions.ts#remakeRecommendations';

/**
 * The free newsletters recommended to you, a few for each topic (plan #947).
 *
 * The page hands over the stored list and this never asks for another on its
 * own, with one exception: when nothing is stored yet, it starts a run as soon
 * as it is on screen. That run searches the web and takes about a minute, so
 * it is started from here rather than while the page renders, and the page
 * shows a loading state instead of waiting on it.
 *
 * Reload calls the same action. While it runs the list stays where it is, and
 * a run that fails leaves it there with a banner saying so, because the stored
 * row is only replaced when a run found something (lib/news/recommend/make.ts).
 *
 * The Reload button is a form, so without JavaScript it still posts and the
 * page comes back with the new list. The automatic first run needs JavaScript;
 * without it the empty view offers the same button.
 */
export function RecommendedNewsletters({
  stored,
  address,
  timezone,
}: {
  stored: { picks: NewsletterPick[]; madeAt: string } | null;
  address: string | null;
  timezone: string;
}) {
  const [state, run, pending] = useActionState<RecommendState, FormData>(
    remakeRecommendations,
    { status: 'idle' },
  );

  // A ref rather than state, so the second effect run in development's strict
  // mode sees the first and does not start a second paid run.
  const started = useRef(false);
  useEffect(() => {
    if (stored || started.current) return;
    started.current = true;
    startTransition(() => run(new FormData()));
  }, [stored, run]);

  const list = state.status === 'made' ? state : stored;
  const failed = state.status === 'failed' && !pending ? state.message : null;

  const reload = (
    <form action={run} className="flex items-center gap-1">
      <PaidHint action={ACTION} what="Cost of making a new list" align="end" />
      <Button type="submit" size="sm" variant="secondary" pending={pending}>
        <RotateCw className="size-3.5" strokeWidth={1.75} aria-hidden />
        {pending ? 'Searching…' : list ? 'Reload' : 'Make the list'}
      </Button>
    </form>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {failed && (
        <Banner tone="bad">
          {list
            ? `The new list could not be made, so this is still the one from ${formatArrival(list.madeAt, timezone)}. ${failed}`
            : `The list could not be made. ${failed}`}
        </Banner>
      )}

      <Card padding="standard" className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-body text-ink">
              Free newsletters for the topics your stories fall under. Sign up with your
              News address and they arrive here.
            </p>
            {list && (
              <p className="text-ui text-ink-muted">
                Made {formatArrival(list.madeAt, timezone)}
              </p>
            )}
          </div>
          {reload}
        </div>

        {address ? (
          <AddressCard address={address} />
        ) : (
          <p className="text-ui text-ink-muted">
            This deployment has no mail domain, so there is no address to sign up with yet.
            News settings says what is missing.
          </p>
        )}

        {list ? (
          groupPicks(list.picks).map(({ topic, picks }) => (
            <Group key={topic} title={topic}>
              <ul className="divide-y divide-border">
                {picks.map((pick) => (
                  <li key={pick.link} className="py-2.5 first:pt-0 last:pb-0">
                    <a
                      href={pick.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-baseline gap-1.5 text-body font-medium text-ink underline-offset-2 hover:text-accent hover:underline"
                    >
                      {pick.name}
                      <ExternalLink
                        className="size-3.5 shrink-0 translate-y-0.5 text-ink-muted"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      <span className="sr-only"> (sign-up page, opens in a new tab)</span>
                    </a>
                    {pick.publisher !== pick.name && (
                      <span className="ml-2 text-ui text-ink-muted">{pick.publisher}</span>
                    )}
                    <p className="mt-0.5 text-ui text-ink-muted">{pick.reason}</p>
                  </li>
                ))}
              </ul>
            </Group>
          ))
        ) : pending ? (
          <div className="space-y-3" role="status">
            <p className="text-ui text-ink-muted">
              Searching for newsletters on each topic. This takes about a minute.
            </p>
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3.5 w-full max-w-md" />
              </div>
            ))}
          </div>
        ) : failed ? null : (
          <p className="text-ui text-ink-muted">No list has been made yet.</p>
        )}
      </Card>
    </div>
  );
}
