import { Card, CardSection } from '@/components/ui/card';
import { RefLink } from '@/components/ui/ref-link';
import { linkVariants } from '@/components/ui/link';
import { cn } from '@/lib/cn';
import type { RefPreview } from '@/lib/core/ref-preview';

/**
 * A ref link's preview held open (plan #1931.4), the hidden part of every
 * comment, Dash reply and plan detail that names a row: hovering the link
 * from laptop width, or holding it on a phone, shows the row's title line
 * and whose move it is. Drawn three ways: answered, still loading, and a row
 * that has gone.
 */

const WAITING: RefPreview = {
  title: 'Every row has a page, a section and a parent in the catalogue so a path can be drawn to it',
  missing: false,
  label: '#1931.1',
  move: { state: 'waiting', waitingOn: '#1931.2 PageHeader draws the path on every page' },
};

const ON_YOU: RefPreview = {
  title: 'Which panel does a preview open on a phone?',
  missing: false,
  label: '#1931.6',
  move: { state: 'on_you' },
};

const GONE: RefPreview = { title: 'no longer there', missing: true, move: null };

const REF = cn('comment-ref', linkVariants());

/** Dash's turns take the recessed ground, as the thread draws them (components/thread/thread.tsx). */
function Said({ who, room, children }: { who: string; room: string; children: React.ReactNode }) {
  return (
    <div className={room}>
      <div className={cn('flex flex-col gap-1', who === 'Dash' ? 'voice-dash -mx-2 px-2 py-1.5' : 'voice-you')}>
        <span className="text-small font-semibold text-ink">{who}</span>
        <p className="comment-prose text-body text-ink">{children}</p>
      </div>
    </div>
  );
}

export function RefPreviewSurface() {
  return (
    <Card>
      <CardSection title="Comments on #1931.4" padding="standard">
        <div className="flex flex-col gap-6">
          <Said who="Dash" room="pb-40">
            Built the search half. The preview is left for the next run, since it waits on{' '}
            <RefLink href="/dev/plan/1931.1" previewKey="#1931.1" className={REF} defaultOpen initial={WAITING}>
              #1931.1
            </RefLink>
            .
          </Said>
          <Said who="You" room="pb-36">
            Before it ships, answer{' '}
            <RefLink href="/dev/plan/1931.6" previewKey="#1931.6" className={REF} defaultOpen initial={ON_YOU}>
              #1931.6
            </RefLink>
            .
          </Said>
          <Said who="Dash" room="pb-24">
            Still reading{' '}
            <RefLink href="/dev/plan/1931.7" previewKey="#1931.7" className={REF} defaultOpen>
              #1931.7
            </RefLink>{' '}
            for you.
          </Said>
          <Said who="Dash" room="pb-20">
            The old idea,{' '}
            <RefLink href="/dev/plan/1204" previewKey="#1204" className={REF} defaultOpen initial={GONE}>
              #1204
            </RefLink>
            , was deleted last month.
          </Said>
        </div>
      </CardSection>
    </Card>
  );
}
