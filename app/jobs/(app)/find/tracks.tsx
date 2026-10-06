'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { CardSection } from '@/components/ui/card';
import { PaidHint } from '@/components/ui/paid-hint';
import type { StartedTrackView, SuggestedTrackView } from '@/lib/jobs/learning/payload';
import { AIM_DEPTH_LABELS, type AimDepth } from '@/lib/learn/aims';
import { dismissTrack, startTrack, suggestTracks } from './actions';

/**
 * Learning tracks for the career goals: what Claude suggests learning to get
 * the job the entries describe, and the tracks already started from here.
 */
export function LearningTracks({
  suggested,
  started,
  hasEntries,
}: {
  suggested: SuggestedTrackView[];
  started: StartedTrackView[];
  hasEntries: boolean;
}) {
  const [pending, run] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const suggest = () => {
    setMessage(null);
    run(async () => {
      const result = await suggestTracks();
      setMessage(result.error ?? result.message ?? null);
    });
  };

  const action = hasEntries ? (
    <span className="flex items-center gap-2">
      <Button type="button" size="sm" variant="secondary" pending={pending} onClick={suggest}>
        {pending ? 'Suggesting…' : suggested.length > 0 ? 'Suggest more' : 'Suggest tracks'}
      </Button>
      <PaidHint action="app/jobs/(app)/find/actions.ts#suggestTracks" what="Cost of suggesting tracks" align="end" />
    </span>
  ) : null;

  return (
    <CardSection
      fold="jobs.fold.Learning tracks"
      title="Learning tracks"
      meta={
        started.length + suggested.length > 0
          ? [
              started.length > 0 ? `${started.length} started` : null,
              suggested.length > 0 ? `${suggested.length} suggested` : null,
            ]
              .filter(Boolean)
              .join(', ')
          : undefined
      }
    >
      {/* The button sits in the body, as on the recommended roles and people,
          so the heading and its counts keep to one line at 390. The line
          beside it explains the section only while it is empty (law 15). */}
      <div className="mb-2 flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          {started.length + suggested.length === 0 && (
            <p className="text-small text-ink-muted">
              {hasEntries
                ? 'Subjects to learn for the job your career goals describe. Starting one adds it to your Learn goals, and Now in Learn brings you its lessons.'
                : 'Write a career goals entry and Dash can suggest what to learn for it.'}
            </p>
          )}
          {message && <p className="text-small text-ink-muted">{message}</p>}
        </div>
        {action}
      </div>

      {started.length > 0 && (
        <ul className="divide-y divide-border">
          {started.map((track) => (
            <StartedRow key={track.id} track={track} />
          ))}
        </ul>
      )}

      {suggested.length > 0 && (
        <>
          {started.length > 0 && (
            <h3 className="mt-3 mb-1 text-small font-medium text-ink-muted">Suggested</h3>
          )}
          <ul className="divide-y divide-border">
            {suggested.map((track) => (
              <SuggestedRow key={track.id} track={track} />
            ))}
          </ul>
        </>
      )}

      {hasEntries && started.length === 0 && suggested.length === 0 && !message && (
        <p className="text-small text-ink-muted">No tracks yet. Suggest some from your entries.</p>
      )}
    </CardSection>
  );
}

function Depth({ depth }: { depth: AimDepth }) {
  const { label, means } = AIM_DEPTH_LABELS[depth];
  return (
    <span className="rounded-full bg-sunken px-1.5 py-0.5 text-small text-ink-muted" title={means}>
      {label}
    </span>
  );
}

function SuggestedRow({ track }: { track: SuggestedTrackView }) {
  const [pending, run] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const answer = (act: typeof startTrack) => {
    setError(null);
    run(async () => {
      const result = await act(track.id);
      if (result.error) setError(result.error);
    });
  };

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-ui font-medium text-ink">{track.name}</span>
        <Depth depth={track.depth} />
      </div>
      {track.about && <p className="mt-0.5 text-small text-ink">{track.about}</p>}
      <p className="mt-0.5 text-small text-ink-muted">{track.why}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" pending={pending} onClick={() => answer(startTrack)}>
          Start track
        </Button>
        <PaidHint action="app/jobs/(app)/find/actions.ts#startTrack" what="Cost of starting the track" />
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => answer(dismissTrack)}>
          Not now
        </Button>
        {error && <span className="text-small text-danger">{error}</span>}
      </div>
    </li>
  );
}

function StartedRow({ track }: { track: StartedTrackView }) {
  const status = track.gone
    ? 'No longer in your Learn goals'
    : track.subjectId
      ? track.units > 0
        ? `${track.units} ${track.units === 1 ? 'unit' : 'units'}`
        : 'Writing its first units'
      : 'Setting up the track';

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline gap-2">
        {track.subjectId && !track.gone ? (
          <Link href={`/learn/s/${track.subjectId}`} className="text-ui font-medium text-accent hover:underline">
            {track.name}
          </Link>
        ) : (
          <span className="text-ui font-medium text-ink">{track.name}</span>
        )}
        <Depth depth={track.depth} />
        <span className="text-small text-ink-muted">{status}</span>
      </div>
      <p className="mt-0.5 text-small text-ink-muted">{track.why}</p>
    </li>
  );
}
