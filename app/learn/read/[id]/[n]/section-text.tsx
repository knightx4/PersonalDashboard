'use client';

import { useState } from 'react';
import { partsOf, type Gloss } from '@/lib/learn/reader/source';

/**
 * The author's text, with a note behind each hard phrase. A phrase with a
 * note is underlined with dots; pressing it opens the note under its
 * paragraph, and pressing it again shuts it. The text itself is never
 * rewritten: the help sits beside it.
 */
export function SectionText({
  paragraphs,
  glosses,
  byline,
}: {
  paragraphs: string[];
  glosses: Gloss[];
  byline: string;
}) {
  const [open, setOpen] = useState<number[]>([]);
  const used = new Set<number>();
  const toggle = (index: number) =>
    setOpen((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
    );

  return (
    <section aria-label="The text" className="space-y-2">
      <div className="vault-prose">
        {paragraphs.map((paragraph, at) => {
          const parts = partsOf(paragraph, glosses, used);
          const shown = parts.flatMap((part) =>
            'gloss' in part && open.includes(part.gloss) ? [part.gloss] : [],
          );
          return (
            <div key={at}>
              <p>
                {parts.map((part, index) =>
                  'gloss' in part ? (
                    <button
                      key={index}
                      type="button"
                      aria-expanded={open.includes(part.gloss)}
                      onClick={() => toggle(part.gloss)}
                      // ui-ok: a phrase that opens its note under the paragraph, not a link to anywhere
                      className="inline cursor-pointer rounded-control text-left underline decoration-accent decoration-dotted decoration-2 underline-offset-4 aria-expanded:bg-accent-tint"
                    >
                      {part.text}
                    </button>
                  ) : (
                    part.text
                  ),
                )}
              </p>
              {shown.map((index) => (
                <p
                  key={index}
                  role="note"
                  className="mt-2 border-l-2 border-accent pl-3 text-ui text-ink-muted"
                >
                  <span className="font-medium text-ink">{glosses[index].phrase}.</span>{' '}
                  {glosses[index].note}
                </p>
              ))}
            </div>
          );
        })}
      </div>
      <p className="text-small text-ink-muted">{byline}. A dotted phrase has a note behind it.</p>
    </section>
  );
}
