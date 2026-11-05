'use client';

import { useEffect, useState } from 'react';
import { MockupViewer } from '@/components/dev/mockups';
import { TheOptions, TheQuestion } from '@/components/dev/question';
import { Note } from '@/components/ui/note';
import type { MockupPicture } from '@/lib/plan/mockups';

/**
 * Questions with pictures kept beside them (plan #2810.2), drawn from
 * fixtures: a drawing of a screen as a data link, so the gallery asks nobody
 * for a file.
 */

function drawing(width: 390 | 1280, name: string, ground: string, accent: string): string {
  const height = width === 390 ? 844 : 800;
  const rows = Array.from({ length: width === 390 ? 7 : 6 }, (_, i) => {
    const y = 140 + i * (width === 390 ? 90 : 100);
    return `<rect x="24" y="${y}" width="${width - 48}" height="64" rx="10" fill="${accent}" opacity="0.18"/>`;
  }).join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${ground}"/>` +
    `<rect x="24" y="40" width="${Math.round(width / 3)}" height="28" rx="6" fill="${accent}"/>` +
    `<text x="24" y="104" font-family="sans-serif" font-size="22" fill="#334">${name}</text>` +
    rows +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const LINK = 'https://claude.ai/artifact/preview-fixture';

function pair(letter: string | null, name: string, accent: string): MockupPicture[] {
  return [
    { letter, width: 390, url: drawing(390, name, '#f6f7fb', accent), link: LINK }, // ui-ok: raw-hex -- the colours of a drawn screen, which no theme repaints
    { letter, width: 1280, url: drawing(1280, name, '#f6f7fb', accent), link: LINK }, // ui-ok: raw-hex -- the colours of a drawn screen, which no theme repaints
  ];
}

const BY_OPTION: MockupPicture[] = [
  ...pair('A', 'Rows in one column', '#3b6fd8'), // ui-ok: raw-hex -- the colours of a drawn screen, which no theme repaints
  ...pair('B', 'Cards in a grid', '#2f9e6e'), // ui-ok: raw-hex -- the colours of a drawn screen, which no theme repaints
];

const WHOLE: MockupPicture[] = pair(null, 'The proposed screen', '#8a5cd6'); // ui-ok: raw-hex -- the colours of a drawn screen, which no theme repaints

const DETAIL = [
  'A — One column of rows. Reads the same on a phone and a laptop, and every row keeps its action in reach.',
  'B — A grid of cards. Shows more at once on a laptop, and drops to one column on a phone.',
  'C — Keep it as it is. Nothing to build, and the list stays hard to scan.',
  'Recommend A: it is the layout the rest of the page already uses.',
].join('\n');

const PLAIN = 'A — Ship it as CSV. One file, opens anywhere.\nB — Ship it as JSON. Keeps the nesting.\nRecommend A.';

function Well({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Note tone="caution" glyph={false} role={undefined}>
        <div className="space-y-2.5">{children}</div>
      </Note>
    </div>
  );
}

/** A question with a picture on two of its options and none on the third, one picture of a whole question, and a plain question. */
export function QuestionMockupsSurface() {
  return (
    <div className="space-y-4">
      <Well>
        <TheQuestion outline="2810.2" title="Which layout for the questions list?" />
        <TheOptions detail={DETAIL} mockups={BY_OPTION} />
      </Well>
      <Well>
        <TheQuestion outline="2810.4" title="Does the new header read well?" />
        <TheOptions detail={PLAIN} mockups={WHOLE} />
      </Well>
      <Well>
        <TheQuestion outline="2810.3" title="Which shape for the export?" />
        <TheOptions detail={PLAIN} mockups={[]} />
      </Well>
    </div>
  );
}

/** The pictures still on their way: a shimmer where each will be. */
export function QuestionMockupLoadingSurface() {
  return (
    <Well>
      <TheQuestion outline="2810.2" title="Which layout for the questions list?" />
      <TheOptions detail={DETAIL} mockups={BY_OPTION} holdPictures />
    </Well>
  );
}

/** Pictures whose files will not load: the words stand in and the options read as before. */
export function QuestionMockupFailedSurface() {
  const broken = BY_OPTION.map((p) => ({ ...p, url: '/preview/no-such-picture.png' }));
  return (
    <Well>
      <TheQuestion outline="2810.2" title="Which layout for the questions list?" />
      <TheOptions detail={DETAIL} mockups={broken} />
    </Well>
  );
}

/** The full-screen view, open on option A, over the question it was opened from. */
export function QuestionMockupViewerSurface() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <>
      <Well>
        <TheQuestion outline="2810.2" title="Which layout for the questions list?" />
        <TheOptions detail={DETAIL} mockups={BY_OPTION} />
      </Well>
      {open && (
        <MockupViewer
          pictures={BY_OPTION}
          target={{ letter: 'A', label: 'One column of rows' }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
