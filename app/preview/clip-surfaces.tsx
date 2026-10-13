import { PageHeader } from '@/components/shell/page-header';
import { ClipStream } from '@/app/learn/clips/clip-stream';
import { ClipsEmpty } from '@/app/learn/clips/empty';
import type { PlayerClip } from '@/lib/learn/clips/stream';
import { SubjectClipsView } from '@/app/learn/s/[id]/clips/view';

/**
 * Learn's clip player (plan #1400) in the surface gallery: a queue of three
 * clips before the first tap, and the page before any clips are cut. Nothing
 * here writes: the player only calls its actions once a clip plays.
 */

const CLIPS: PlayerClip[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    videoId: 'ZK3O402wf1c',
    startSeconds: 754,
    endSeconds: 812,
    caption: 'An eigenvector is a direction the matrix only stretches, never turns.',
    title: 'Eigenvectors and eigenvalues | Chapter 14, Essence of linear algebra',
    channel: '3Blue1Brown',
    saved: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    videoId: 'TSdXJw83kyA',
    startSeconds: 301,
    endSeconds: 362,
    caption: 'Why a determinant of zero means the space collapses to a line.',
    title: 'The determinant | Chapter 6, Essence of linear algebra',
    channel: '3Blue1Brown',
    saved: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    videoId: 'aircAruvnKk',
    startSeconds: 120,
    endSeconds: 175,
    caption: 'A neuron here is just a number between 0 and 1.',
    title: 'But what is a neural network? | Deep learning chapter 1',
    channel: '3Blue1Brown',
    saved: false,
  },
];

export function ClipStreamSurface() {
  return (
    <>
      <div className="hidden lg:block">
        <PageHeader title="Clips" />
      </div>
      <ClipStream initial={CLIPS} fixed />
    </>
  );
}

export function ClipsEmptySurface() {
  return <ClipsEmpty />;
}

/**
 * One subject's Clips (plan #1697): the same queue under a long subject name,
 * with the counts in the rail, and the page for a subject no clip serves yet.
 */
const SUBJECT = { id: '00000000-0000-4000-8000-0000000000a1', name: 'Startup finance and FP&A for operators and early-stage founders' };

const SUBJECT_CLIPS: PlayerClip[] = [
  {
    id: '00000000-0000-4000-8000-000000000011',
    videoId: 'LBC16jhiwak',
    startSeconds: 312,
    endSeconds: 402,
    caption: 'Using default alive to find the path to profitability',
    title: 'Kirsty Nathoo - Managing Startup Finances',
    channel: 'Y Combinator',
    saved: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000012',
    videoId: 'LBC16jhiwak',
    startSeconds: 537,
    endSeconds: 617,
    caption: 'Account for all employee costs, not just salary',
    title: 'Kirsty Nathoo - Managing Startup Finances',
    channel: 'Y Combinator',
    saved: true,
  },
];

export function SubjectClipsSurface() {
  return (
    <SubjectClipsView
      subject={SUBJECT}
      clips={SUBJECT_CLIPS}
      counts={{ watchLater: 18, channels: 10, unplayed: 23 }}
      fixed
    />
  );
}

export function SubjectClipsEmptySurface() {
  return <SubjectClipsView subject={SUBJECT} clips={[]} counts={{ watchLater: 0, channels: 0, unplayed: 0 }} fixed />;
}
