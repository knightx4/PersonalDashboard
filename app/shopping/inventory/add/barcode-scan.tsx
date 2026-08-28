'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import { saveOwnedBook, searchOwnedBook, type BookActionState } from './actions';
import { AddBookManualForm } from './add-book-forms';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';

/**
 * In-browser ISBN / EAN-13 scan. Camera stays on-device; only the decoded
 * ISBN is sent to the server resolver.
 */
export function BarcodeScanPanel() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [searchState, searchAction, searchPending] = useActionState(
    searchOwnedBook,
    {} as BookActionState,
  );
  const [saveState, saveAction, savePending] = useActionState(
    saveOwnedBook,
    {} as BookActionState,
  );
  const controlsRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    return () => {
      controlsRef.current?.stop();
    };
  }, []);

  async function startScan() {
    setError(null);
    setLastCode(null);
    if (!videoRef.current) return;

    try {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
      ]);
      const reader = new BrowserMultiFormatReader(hints);
      setScanning(true);
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result, _err, controls) => {
          if (!result) return;
          const text = result.getText();
          setLastCode(text);
          controls.stop();
          controlsRef.current = null;
          setScanning(false);
          const fd = new FormData();
          fd.set('query', text);
          searchAction(fd);
        },
      );
      controlsRef.current = controls;
    } catch (err) {
      setScanning(false);
      setError(
        err instanceof Error
          ? err.message
          : 'Could not open the camera. Use HTTPS and allow camera access.',
      );
    }
  }

  function stopScan() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  }

  function saveCurrent(forceConfirmed: boolean) {
    if (!searchState.book) return;
    const fd = new FormData();
    fd.set('book_json', JSON.stringify(searchState.book));
    fd.set('force_confirmed', forceConfirmed ? 'true' : 'false');
    fd.set('source', 'manual');
    saveAction(fd);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        Point your camera at the ISBN barcode on the back cover. Scanning needs
        camera permission and works best over HTTPS.
      </p>
      <div className="overflow-hidden rounded-xl border border-border bg-black">
        <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
      </div>
      <div className="flex flex-wrap gap-2">
        {!scanning ? (
          <Button type="button" onClick={startScan}>
            Start camera
          </Button>
        ) : (
          <Button type="button" variant="secondary" onClick={stopScan}>
            Stop
          </Button>
        )}
      </div>
      {lastCode && (
        <p className="font-mono text-sm text-ink-muted">Last code: {lastCode}</p>
      )}
      <FieldError>{error ?? searchState.error ?? saveState.error}</FieldError>
      {searchPending && <p className="text-sm text-ink-muted">Looking up ISBN…</p>}
      {saveState.message && (
        <p className="text-sm text-brand">
          {saveState.message}{' '}
          {saveState.savedIds?.[0] && (
            <Link className="underline" href={`/shopping/inventory/${saveState.savedIds[0]}`}>
              View item
            </Link>
          )}
        </p>
      )}
      {!searchState.book && searchState.error && (
        <AddBookManualForm compact isbn={searchState.manualIsbn ?? lastCode} />
      )}
      {searchState.book && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="font-medium text-ink">{searchState.book.title}</p>
          <p className="text-sm text-ink-muted">
            {searchState.book.authors.join(', ')}
            {searchState.book.isbn13 ? ` · ${searchState.book.isbn13}` : ''}
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            disabled={savePending}
            onClick={() => saveCurrent(true)}
          >
            Add to library
          </Button>
        </div>
      )}
    </div>
  );
}
