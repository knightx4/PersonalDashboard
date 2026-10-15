'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SectionHeading } from '@/components/ui/section-heading';
import type { PlacesMapDrawing } from '@/lib/you/places-map';
import { PlacesMap } from './places-map';

type Position = { latitude: number; longitude: number };

/**
 * Where a place is on the map, on its own page (plan #2091.5). A place with
 * a position shows it, with Move and Clear; one without says so, with Set
 * on map. Set on map (or Move) turns the next press on the map into the
 * place's position: a hint line says so until that press or Cancel, and a
 * save that fails says so under the map and leaves it waiting for another
 * press.
 *
 * The map shows the place's own region, or the region of their other
 * places when it has no position, and can be widened to the whole world for
 * a place that lies outside it. With no region to show (`drawing` null) it
 * opens on the whole world. The whole world is drawn on the server only
 * when asked for (`loadWorld`), since its outlines are large.
 *
 * `save` and `loadWorld` are the server actions, passed in so the gallery
 * can draw every state without them; `start` opens a state for the gallery.
 */
export function PlaceMapSection({
  placeId,
  positioned,
  drawing,
  save,
  loadWorld,
  start,
}: {
  placeId: string;
  positioned: boolean;
  /** The place's region, or their other places' region; null when there is neither. */
  drawing: PlacesMapDrawing | null;
  save?: (id: string, position: Position | null) => Promise<{ error?: string }>;
  loadWorld?: () => Promise<PlacesMapDrawing>;
  start?: { placing?: boolean; error?: string; worldDrawing?: PlacesMapDrawing };
}) {
  const [placing, setPlacing] = useState(start?.placing ?? false);
  const [error, setError] = useState<string | null>(start?.error ?? null);
  const [worldDrawing, setWorldDrawing] = useState<PlacesMapDrawing | null>(
    start?.worldDrawing ?? null,
  );
  const [showWorld, setShowWorld] = useState(false);
  const [saving, startSaving] = useTransition();
  const [widening, startWidening] = useTransition();

  const shown = (showWorld || !drawing ? worldDrawing : drawing) ?? null;

  /** Draws the whole world once, then runs `then`. */
  function withWorld(then: () => void) {
    if (worldDrawing) {
      then();
      return;
    }
    startWidening(async () => {
      try {
        const loaded = await loadWorld?.();
        if (!loaded) return;
        setWorldDrawing(loaded);
        then();
      } catch {
        setError('The map could not be drawn. Try again.');
      }
    });
  }

  function begin() {
    setError(null);
    if (drawing) setPlacing(true);
    else withWorld(() => setPlacing(true));
  }

  function cancel() {
    setPlacing(false);
    setError(null);
    setShowWorld(false);
  }

  function press(position: Position) {
    startSaving(async () => {
      const result = (await save?.(placeId, position)) ?? {};
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setPlacing(false);
      setShowWorld(false);
    });
  }

  function clear() {
    setError(null);
    startSaving(async () => {
      const result = (await save?.(placeId, null)) ?? {};
      if (result.error) setError(result.error);
    });
  }

  function widen() {
    if (showWorld) setShowWorld(false);
    else withWorld(() => setShowWorld(true));
  }

  const actions = placing ? (
    <Button variant="secondary" size="sm" onClick={cancel} disabled={saving}>
      Cancel
    </Button>
  ) : positioned ? (
    <>
      <Button variant="secondary" size="sm" onClick={begin} disabled={saving}>
        Move
      </Button>
      <Button variant="secondary" size="sm" onClick={clear} pending={saving}>
        {saving ? 'Clearing…' : 'Clear'}
      </Button>
    </>
  ) : (
    <Button variant="secondary" size="sm" onClick={begin} pending={widening}>
      {widening ? 'Drawing the map…' : 'Set on map'}
    </Button>
  );

  return (
    <section aria-labelledby="place-on-map">
      <SectionHeading id="place-on-map" title="On the map" action={actions} className="mb-2" />
      {(placing || positioned) && shown ? (
        // The hint and the error are strips on the map's own card, so the
        // message about a press sits on the map it is about.
        <Card padding="none" className="overflow-hidden">
          {placing && (
            <div className="card-pad-x flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5">
              <p role="status" className="text-ui text-ink">
                {saving ? 'Putting it on the map…' : 'Press the map where this place is.'}
              </p>
              {drawing && (
                <Button variant="link" onClick={widen} pending={widening} disabled={saving}>
                  {showWorld
                    ? 'Back to your region'
                    : widening
                      ? 'Drawing the world…'
                      : 'Show the whole world'}
                </Button>
              )}
            </div>
          )}
          <PlacesMap
            drawing={shown}
            linkDots={false}
            capped
            onPressPosition={placing && !saving ? press : undefined}
          />
          {error && <ErrorStrip error={error} />}
        </Card>
      ) : (
        <Card padding="none">
          <p className="card-pad-x py-3 text-ui text-ink-muted">
            Not on the map yet. Press Set on map, then the spot on the map where it is.
          </p>
          {error && <ErrorStrip error={error} />}
        </Card>
      )}
    </section>
  );
}

function ErrorStrip({ error }: { error: string }) {
  return (
    <p role="alert" className="card-pad-x py-2.5 text-small text-danger">
      {error}
    </p>
  );
}
