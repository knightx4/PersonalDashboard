import { PageHeader } from '@/components/shell/page-header';
import { ClipStream } from '@/app/learn/clips/clip-stream';
import { ClipsEmpty } from '@/app/learn/clips/empty';
import type { PlayerClip } from '@/lib/learn/clips/stream';

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
        <PageHeader
          title="Clips"
          description="Short clips from your videos, one after another. Swipe up, press the down arrow or let one finish for the next."
        />
      </div>
      <ClipStream initial={CLIPS} startedAt="2026-10-02T12:00:00.000Z" fixed />
    </>
  );
}

export function ClipsEmptySurface() {
  return <ClipsEmpty />;
}
