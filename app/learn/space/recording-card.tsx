'use client';

import { useState } from 'react';
import { Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { CheckRow } from '@/components/ui/field';
import type { Recording } from '@/lib/learn/map/recording';

/**
 * Recording mode's switch in Idea Space's rail (plan #1997.9). Off, it lists
 * the places so the person can tick the ones to hide; on, it says how many
 * are hidden and does not list them, since the list would name them. The
 * choice is remembered per person through `save`.
 */

type Saved = { ok: true } | { ok: false; error: string };

export function RecordingCard({
  places,
  recording,
  onChange,
  save,
  chooseOpen = false,
}: {
  /** The places under their real names; only drawn while recording is off. */
  places: readonly { id: string; name: string }[];
  recording: Recording;
  onChange: (next: Recording) => void;
  save?: (next: Recording) => Promise<Saved>;
  /** The gallery draws the list of places open. */
  chooseOpen?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  if (places.length === 0 && !recording.on) return null;

  const hiddenHere = recording.hidden.filter((id) => places.some((place) => place.id === id));
  const change = (next: Recording) => {
    onChange(next);
    setError(null);
    if (!save) return;
    save(next).then(
      (result) => {
        if (!result.ok) setError(result.error);
      },
      () => setError('Saving that failed. Reload to see what was kept.'),
    );
  };
  const toggle = (id: string) =>
    change({
      ...recording,
      hidden: recording.hidden.includes(id)
        ? recording.hidden.filter((other) => other !== id)
        : [...recording.hidden, id],
    });

  const row = (place: { id: string; name: string }) => (
    <li key={place.id}>
      <CheckRow
        title={place.name}
        checked={recording.hidden.includes(place.id)}
        onChange={() => toggle(place.id)}
        className="min-h-11 items-center"
      />
    </li>
  );

  return (
    <Card padding="standard">
      <h2 className="flex items-center gap-2 text-ui font-semibold text-ink">
        <Video className="size-4 text-ink-muted" strokeWidth={1.75} aria-hidden />
        Recording mode
      </h2>
      {recording.on ? (
        <>
          <p className="mt-1 text-ui text-ink-muted">
            On.{' '}
            {hiddenHere.length === 0
              ? 'No place is hidden.'
              : `${hiddenHere.length} ${hiddenHere.length === 1 ? 'place is' : 'places are'} hidden`}
            , along with the ideas in {hiddenHere.length === 1 ? 'it' : 'them'}.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => change({ ...recording, on: false })}
          >
            Stop recording mode
          </Button>
        </>
      ) : (
        <>
          <p className="mt-1 text-small text-ink-muted">
            Chosen places show as &ldquo;A private place&rdquo;, and the ideas in them as
            &ldquo;Private idea&rdquo;.
          </p>
          <Disclosure
            title="Places to hide"
            meta={`${hiddenHere.length} of ${places.length}`}
            defaultOpen={chooseOpen}
            className="mt-1"
            bodyClassName="pl-0"
          >
            <ul className="divide-y divide-border">{places.map(row)}</ul>
          </Disclosure>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            disabled={hiddenHere.length === 0}
            onClick={() => change({ ...recording, on: true })}
          >
            Start recording mode
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-small text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
