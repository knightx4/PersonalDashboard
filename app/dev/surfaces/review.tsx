'use client';

import { useActionState, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ComposeBody, FieldError } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Banner } from '@/components/ui/banner';
import { cn } from '@/lib/cn';
import { planHref } from '@/lib/search/sources/dev-map';
import type { SurfaceChange } from '@/lib/plan/screen-change';
import { noteOnSurface, type SurfaceNoteState } from './actions';

export type SurfaceNote = {
  id: string;
  body: string;
  status: string;
  resolutionNote: string | null;
};

export type ReviewSurface = {
  id: string;
  label: string;
  module: string;
  /** The step that changed it in the last seven days, or null (plan #1542). */
  changed?: SurfaceChange | null;
  notes: SurfaceNote[];
};

/** "5 Oct". In UTC, so the server's render and the browser's agree. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * A surface, framed at a real width, with a box to say what is wrong.
 *
 * It is an `<iframe>` of `/preview?s=<id>` rather than the component rendered
 * inline, and that is the whole reason this works. Rendering it inline would
 * put it inside this page's own width, this page's own scroll and this page's
 * own shell -- so a surface that only breaks at 390px would never break here,
 * and the thing being reviewed would be a different thing from the thing that
 * ships. The frame gives it a real viewport to be 390 pixels wide inside.
 *
 * Phone first, because that is where this app is used and where every fault
 * found so far has been. The laptop width is a toggle, not the default.
 */
export function SurfaceReview({
  surfaces,
  show: startShow = 'all',
}: {
  surfaces: ReviewSurface[];
  /** Which surfaces to start on; the gallery shoots both. */
  show?: 'all' | 'changed';
}) {
  const [width, setWidth] = useState<'phone' | 'laptop'>('phone');
  // "Changed this week" (plan #1542): only the surfaces a step changed in the
  // last seven days, which is where a correction is most likely to be due.
  const [show, setShow] = useState<'all' | 'changed'>(startShow);
  const changedCount = surfaces.filter((surface) => surface.changed).length;
  const shown = show === 'changed' ? surfaces.filter((surface) => surface.changed) : surfaces;
  const modules = [...new Set(shown.map((surface) => surface.module))];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Width"
          value={width}
          onChange={setWidth}
          options={[
            { value: 'phone', label: 'Phone · 390' },
            { value: 'laptop', label: 'Laptop · 1280' },
          ]}
        />
        <Segmented
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: `All · ${surfaces.length}` },
            { value: 'changed', label: `Changed this week · ${changedCount}` },
          ]}
        />
        <p className="text-small text-ink-muted">A note here joins the queue in Bugs and requests</p>
      </div>

      {shown.length === 0 && (
        <p className="text-ui text-ink-muted">No step changed a screen in the last seven days.</p>
      )}

      {/* The sections are named so /dev/ui/review can send you straight to one
          module's surfaces rather than to the top of a page of six modules'. */}
      {modules.map((module) => (
        <section key={module} id={`surfaces-${module}`} className="space-y-3">
          <h2 className="text-ui font-semibold text-ink capitalize">{module}</h2>
          {shown
            .filter((surface) => surface.module === module)
            .map((surface) => (
              <SurfaceCard key={surface.id} surface={surface} width={width} />
            ))}
        </section>
      ))}
    </div>
  );
}

function SurfaceCard({ surface, width }: { surface: ReviewSurface; width: 'phone' | 'laptop' }) {
  const [state, action, pending] = useActionState(noteOnSurface, {} as SurfaceNoteState);
  const [composing, setComposing] = useState(false);
  const open = surface.notes.filter((note) => note.status !== 'done' && note.status !== 'declined');

  return (
    <Card padding="dense" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-ui font-medium text-ink">{surface.label}</h3>
          {surface.changed && (
            <p className="text-small text-ink-muted">
              Changed by{' '}
              <a href={planHref(surface.changed.step)} className="text-accent hover:underline">
                #{surface.changed.step}
              </a>{' '}
              on {shortDate(surface.changed.checkedAt)}
            </p>
          )}
        </div>
        <a
          href={`/preview?s=${surface.id}`}
          target="_blank"
          rel="noreferrer"
          className="press-area shrink-0 text-small text-ink-muted hover:text-accent"
        >
          Open alone
        </a>
      </div>

      {/*
        * Frame left, words right.
        *
        * The first version stacked them and the frame is only 254 physical
        * pixels wide once a 390px viewport is scaled to fit -- so a full-width
        * card left about nine hundred pixels of nothing beside every surface,
        * and the notes sat below the fold. They belong next to the thing they
        * are about.
        *
        * Scaled rather than resized: `transform: scale` keeps the layout at its
        * real width and only draws it smaller, so what is being judged is
        * genuinely the 390px layout. Resizing the frame would just be a
        * narrower desktop, which is the mistake this whole tool exists to stop.
        */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div
          className="shrink-0 overflow-hidden rounded-control bg-canvas"
          style={
            width === 'phone'
              ? { width: 390 * 0.65, height: 700 * 0.65 }
              : { width: 1280 * 0.34, height: 900 * 0.34 }
          }
        >
          <iframe
            key={`${surface.id}-${width}`}
            src={`/preview?s=${surface.id}`}
            title={surface.label}
            loading="lazy"
            className="origin-top-left border-0"
            style={
              width === 'phone'
                ? { width: 390, height: 700, transform: 'scale(0.65)' }
                : { width: 1280, height: 900, transform: 'scale(0.34)' }
            }
          />
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          {open.length > 0 ? (
            <ul className="space-y-1">
              {open.map((note) => (
                <li key={note.id} className="flex gap-2 text-small">
                  <span
                    className={cn(
                      'shrink-0',
                      note.status === 'blocked' ? 'text-caution' : 'text-ink-ghost',
                    )}
                  >
                    ·
                  </span>
                  <span className="text-ink-muted">{note.body}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-small text-ink-ghost">Nothing said about this one yet.</p>
          )}
        </div>
      </div>

      {/* Closed until asked for. Nineteen surface cards each carrying an open
        * box is the fault this page exists to catch, and it was on the page
        * doing the catching until check:ui grew the law 14 rule. */}
      {composing ? (
        <form action={action} className="flex items-end gap-2">
          <input type="hidden" name="surface" value={surface.id} />
          <ComposeBody
            name="body"
            rows={1}
            autoFocus
            aria-label={`What is wrong with ${surface.label}`}
            placeholder="What is wrong with this?"
            className="flex-1"
          />
          <Button type="submit" size="sm" variant="secondary" pending={pending}>
            Note
          </Button>
        </form>
      ) : (
        <AddTrigger label="Note something" onClick={() => setComposing(true)} />
      )}
      <FieldError>{state.error}</FieldError>
      {state.message && <Banner tone="info">{state.message}</Banner>}
    </Card>
  );
}
