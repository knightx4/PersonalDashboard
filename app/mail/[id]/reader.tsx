'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
    // The body's own height, since the root's scrollHeight is never less than
    // the frame's, so measuring it would only ever make the frame taller.
    const body = frame.current?.contentDocument?.body;
    if (body) setHeight(Math.ceil(body.getBoundingClientRect().height) + 8);
  }, []);

  // The frame can finish loading before this component hydrates, and its load
  // event is then never heard, which left a long email cut at the first 240px.
  // So the effect looks at the frame as it is, and listens for a later load.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let watcher: ResizeObserver | null = null;
    let timer = 0;
    const wire = () => {
      fit();
      // Images and fonts arriving after load, and a narrower window, change
      // the height; watching the body keeps the frame as tall as the email.
      const body = el.contentDocument?.body;
      watcher?.disconnect();
      if (body && typeof ResizeObserver !== 'undefined') {
        watcher = new ResizeObserver(fit);
        watcher.observe(body);
      }
      timer = window.setTimeout(fit, 800);
    };
    el.addEventListener('load', wire);
    if (el.contentDocument?.readyState === 'complete' && el.contentDocument.body) wire();
    return () => {
      el.removeEventListener('load', wire);
      watcher?.disconnect();
      window.clearTimeout(timer);
    };
  }, [fit, html]);

  const srcDoc =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<base target="_blank">' +
    '<style>html,body{margin:0;padding:0;background:#fff;color:#111;}body{padding:8px 12px;' +
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
      style={{ height }}
      className="block w-full rounded-control bg-white"
    />
  );
}

/** Back to wherever the link was tapped, or home when the reader was opened directly. */
export function BackButton() {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => (window.history.length > 1 ? router.back() : router.push('/home'))}
      className="mb-3 -ml-2.5"
    >
      <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden /> Back
    </Button>
  );
}
