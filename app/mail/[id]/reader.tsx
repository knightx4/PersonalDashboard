'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';

/**
 * One email's HTML, drawn in a sandboxed frame.
 *
 * No `allow-scripts`, so nothing in the email runs. `allow-same-origin` is
 * there only so this page can read the frame's height and size it to the
 * email, which is safe while scripts are off. Links open in a new tab.
 */
export function EmailFrame({ html, title }: { html: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);

  const fit = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (doc?.documentElement) setHeight(doc.documentElement.scrollHeight + 8);
  }, []);

  const srcDoc =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<base target="_blank">' +
    '<style>html,body{margin:0;padding:0;background:#fff;color:#111;' +
    'font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
    'overflow-wrap:anywhere}img{max-width:100%;height:auto}' +
    'table{max-width:100%}</style></head><body>' +
    html +
    '</body></html>';

  return (
    <iframe
      ref={frame}
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      onLoad={() => {
        fit();
        // Images arriving after load change the height; one late look covers most.
        window.setTimeout(fit, 800);
      }}
      style={{ height }}
      className="block w-full rounded-control bg-white"
    />
  );
}

/** Back to wherever the link was tapped, or home when the reader was opened directly. */
export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push('/home'))}
      className="mb-3 inline-flex items-center gap-1.5 text-ui text-ink-muted transition-colors duration-150 hover:text-ink"
    >
      <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden /> Back
    </button>
  );
}
