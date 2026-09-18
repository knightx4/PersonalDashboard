'use client';

import { useEffect, useRef, useState } from 'react';
import { frameMessage, issueDocument } from '@/lib/news/issues/frame';

/**
 * The room a newsletter is shown in.
 *
 * `sandbox` is the list of what is allowed, and everything left out is
 * refused: no form can be submitted, no link can move the page around the
 * frame, no window can be opened, and without `allow-same-origin` what runs
 * inside has no origin in common with the app and cannot read anything of
 * yours. `allow-scripts` is in the list because #459 settled that the frame
 * measures itself, which takes a few lines of the app's own script inside it.
 *
 * Those lines say how tall the newsletter is and hand out the address of any
 * link that is clicked. Both arrive here as messages, and a message from any
 * window but this frame's own is dropped without being read -- the check is in
 * `frameMessage`, next to the shapes it accepts.
 *
 * The height starts as a window's worth and becomes the newsletter's own the
 * moment it is measured, which is also what keeps a late picture from leaving
 * the bottom of the issue cut off.
 */
export function IssueFrame({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const message = frameMessage(event.data, event.source, frame.current?.contentWindow ?? null);
      if (!message) return;

      if (message.kind === 'height') {
        setHeight(message.height);
        return;
      }
      // #462: the frame passes the address out and the page opens the tab.
      window.open(message.href, '_blank', 'noopener,noreferrer');
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <iframe
      ref={frame}
      title="The newsletter"
      srcDoc={issueDocument(html)}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      scrolling={height === null ? undefined : 'no'}
      style={height === null ? undefined : { height: `${height}px` }}
      className={`block w-full overflow-hidden rounded-card border border-border bg-white${
        height === null ? ' h-[70vh]' : ''
      }`}
    />
  );
}
