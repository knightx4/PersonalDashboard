'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/cn';
import { popoverSurface } from '@/components/ui/popover';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { FiledLines } from '@/components/shell/capture';
import { AimedCaptureForm } from '@/components/shell/capture-aim';
import { CAPTURE_KINDS } from '@/lib/capture/actions';
import {
  CaptureFoot,
  CaptureHeader,
  FiledCaptures,
  PlaceLine,
} from '@/components/shell/capture-places';
import { AddFile } from '@/components/attachments/add-file';
import { captureAction, CAPTURE_ACTIONS, type CaptureAction } from '@/lib/capture/actions';
import { goalsPlaceName } from '@/lib/capture/destination';
import type { FiledCapture } from '@/lib/capture/place';
import type { CapturePlace, CaptureSort } from '@/lib/capture/sort';
import type { UploadedAttachment } from '@/lib/attachments/rules';

/** A photo added with the sentence (plan #1714), already in the bucket. */
const UPLOADED: UploadedAttachment[] = [
  {
    path: '00000000-0000-4000-8000-0000000000aa/00000000-0000-4000-8000-0000000000ab-IMG_4471.jpg',
    name: 'IMG_4471.jpg',
    contentType: 'image/jpeg',
    size: 2_310_000,
  },
];

/**
 * The one capture box (plan #1581) in the surface gallery, drawn twice from
 * fixtures: while a two-part sentence is typed, with the line saying where
 * each part will go, and after four things were filed (a note into the
 * vault's Inbox among them, plan #1582, and a todo filed with a photo, plan
 * #1714), with a sentence Dash
 * is not sure about asking for a place. The real panel floats over the page;
 * here the same pieces sit in its surface without the scrim.
 */

const ACTION = captureAction('anything') as CaptureAction;
/** Every place, the vault included: its token can write (plan #1582). */
const PLACES: CapturePlace[] = ['todo', 'goals', 'jobs', 'vault'];
const ROLE = { id: '00000000-0000-4000-8000-000000000002', title: 'Senior Product Analyst, Payments Risk', company: 'Lattice Pay' };
const GOAL = { id: '00000000-0000-4000-8000-000000000001', title: 'Run a half marathon before the end of March' };

const TWO_PARTS: CaptureSort = {
  parts: [
    { place: 'jobs', text: 'Sent the cover letter to Lattice Pay', goal: null, role: ROLE },
    { place: 'todo', text: 'chase Sam on Friday', goal: null, role: null },
  ],
  confidence: 0.92,
  sure: true,
};

const FILED: FiledCapture[] = [
  {
    place: 'vault',
    text: 'A book about tide pools, told through one rock over a whole year of tides',
    where: 'Vault · Inbox',
    href: '/vault',
    actionId: '00000000-0000-4000-8000-000000000010',
    goals: null,
    undoneAt: null,
  },
  {
    place: 'todo',
    text: 'Book the dentist for the week after next',
    where: 'Todo · Today',
    href: '/todo',
    actionId: '00000000-0000-4000-8000-000000000011',
    goals: null,
    undoneAt: null,
    files: 1,
  },
  {
    place: 'goals',
    text: 'Ran 10k this morning in 58 minutes, the furthest yet',
    where: `Goals · ${GOAL.title}`,
    href: '/goals',
    actionId: null,
    goals: {
      captureId: '00000000-0000-4000-8000-000000000012',
      entries: [
        {
          kind: 'close',
          step_id: '00000000-0000-4000-8000-000000000013',
          title: 'Run 10k without stopping',
          goal_title: GOAL.title,
          undone_at: null,
        },
      ],
    },
    undoneAt: null,
  },
  {
    place: 'jobs',
    text: 'Recruiter is Sam Okafor, second round is a case study',
    where: `Job search · ${ROLE.title} at ${ROLE.company}`,
    href: '/jobs',
    actionId: '00000000-0000-4000-8000-000000000014',
    goals: null,
    undoneAt: '2026-10-04T09:00:00Z',
  },
];

const nothing = () => {};

function Box({
  text,
  children,
}: {
  text: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(popoverSurface, 'w-full overflow-hidden shadow-2xl')}>
      <CaptureHeader action={ACTION} actions={CAPTURE_ACTIONS} onSwitch={nothing} />
      <textarea
        readOnly
        value={text}
        placeholder={ACTION.placeholder}
        aria-label={ACTION.label}
        rows={3}
        data-focus-ring="none"
        className="w-full resize-none bg-transparent px-3 py-3 text-body text-ink outline-none placeholder:text-ink-ghost"
      />
      {children}
    </div>
  );
}

export function CaptureBoxSurface() {
  return (
    <div className="space-y-8 py-4">
      <Box text="Sent the cover letter to Lattice Pay, chase Sam on Friday">
        <PlaceLine guess={{ state: 'answered', sort: TWO_PARTS }} places={PLACES} picked={null} onPick={nothing} />
        <CaptureFoot
          pending={false}
          costs={{}}
          files={<AddFile value={UPLOADED} onChange={nothing} />}
        />
      </Box>
      <Box text="Lunch with Priya">
        <PlaceLine
          guess={{ state: 'answered', sort: { parts: [], confidence: 0, sure: false } }}
          places={PLACES}
          picked={null}
          onPick={nothing}
        />
        <CaptureFoot pending={false} costs={{}} files={<AddFile value={[]} onChange={nothing} />} />
        <FiledCaptures
          filed={FILED}
          busy={null}
          error={null}
          onUndo={nothing}
          goalLines={(item) =>
            item.goals ? (
              <FiledLines filed={item.goals} onChanged={nothing} withinGoal={goalsPlaceName(item.goals.entries)} />
            ) : null
          }
        />
      </Box>
    </div>
  );
}

/**
 * Capture aimed at a kind (plan #1950.1), what an Add button on a list opens:
 * a todo typed with Tomorrow picked, a note aimed at a role with a long title
 * and nothing typed yet, and the toast an add leaves, with Undo. No sort line
 * and no place chips, since pressing Add on the list already said where it
 * goes.
 */
export function AimedCaptureSurface() {
  return (
    <ToastProvider>
      <div className="space-y-8 py-4">
        <Aimed>
          <AimedCaptureForm
            kind={CAPTURE_KINDS.todo}
            text="Book the dentist for the week after next"
            onText={nothing}
            day="tomorrow"
            onDay={nothing}
            pending={false}
            error={null}
            onSubmit={nothing}
          />
        </Aimed>
        <Aimed>
          <AimedCaptureForm
            kind={CAPTURE_KINDS['job-note']}
            role={{
              id: ROLE.id,
              title: 'Senior Product Analyst, Payments Risk and Fraud Operations (EMEA)',
              company: 'Lattice Pay',
            }}
            text=""
            onText={nothing}
            day=""
            onDay={nothing}
            pending={false}
            error={null}
            onSubmit={nothing}
          />
        </Aimed>
        {/* Goals and Dev (plan #1950.5): a goal in the area its New goal was
            pressed in, and the header's note with the page it is about and a
            screenshot added. */}
        <Aimed>
          <AimedCaptureForm
            kind={CAPTURE_KINDS.goal}
            under={{ id: 'area-1', title: 'Health, fitness and getting back to a proper sleep routine' }}
            text="Run the Brooklyn half marathon in under two hours"
            onText={nothing}
            day=""
            onDay={nothing}
            pending={false}
            error={null}
            onSubmit={nothing}
          />
        </Aimed>
        <Aimed>
          <AimedCaptureForm
            kind={CAPTURE_KINDS['dev-note']}
            page="/dev/plan/1950?tab=steps&view=tree"
            files={<AddFile value={NOTE_FILES} onChange={nothing} />}
            text="The step titles run off the side of the screen on my phone"
            onText={nothing}
            day=""
            onDay={nothing}
            pending={false}
            error={null}
            onSubmit={nothing}
          />
        </Aimed>
        <AddedToast />
      </div>
    </ToastProvider>
  );
}

/** A screenshot already added to a note for Dev (plan #1713). */
const NOTE_FILES: UploadedAttachment[] = [
  { path: 'preview/plan-scrolls-sideways.png', name: 'plan-scrolls-sideways.png', contentType: 'image/png', size: 412_000 },
];

function Aimed({ children }: { children: React.ReactNode }) {
  return <div className={cn(popoverSurface, 'w-full overflow-hidden shadow-2xl')}>{children}</div>;
}

/** The toast one press leaves, held open for the shot. */
function AddedToast() {
  const toast = useToast();
  useEffect(() => {
    toast({ text: 'Added to Todo · Tomorrow.', undo: nothing, undone: 'Taken back.', duration: 600_000 });
  }, [toast]);
  return null;
}
