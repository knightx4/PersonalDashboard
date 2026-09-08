'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import { saveGame, searchGame, type GameActionState } from './actions';
import { AddGameManualForm, GameCard } from './game-forms';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FieldError } from '@/components/ui/field';
import { classifyScannedCode } from '@/lib/barcodes/scan-code';
import type { CanonicalGame } from '@/lib/games/types';

/**
 * Generic retail scanner. Reads any EAN-13 / UPC-A / EAN-8; a Bookland code
 * is handed to the book flow, everything else goes to the product lookup.
 */
export function GameScanPanel() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [isbnHit, setIsbnHit] = useState<string | null>(null);
  const [picked, setPicked] = useState<CanonicalGame | null>(null);

  const [searchState, searchAction, searchPending] = useActionState(
    searchGame,
    {} as GameActionState,
  );
  const [saveState, saveAction, savePending] = useActionState(
    saveGame,
    {} as GameActionState,
  );

  useEffect(() => () => controlsRef.current?.stop(), []);

  async function startScan() {
    setCameraError(null);
    setIsbnHit(null);
    setPicked(null);
    if (!videoRef.current) return;
    try {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
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

          const code = classifyScannedCode(text);
          if (code?.kind === 'isbn') {
            setIsbnHit(code.isbn13);
            return;
          }
          const fd = new FormData();
          fd.set('query', text);
          searchAction(fd);
        },
      );
      controlsRef.current = controls;
    } catch (err) {
      setScanning(false);
      setCameraError(
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

  const shown = picked ?? searchState.game ?? null;

  function save(forceConfirmed: boolean) {
    if (!shown) return;
    const fd = new FormData();
    fd.set('game_json', JSON.stringify(shown));
    fd.set('force_confirmed', forceConfirmed ? 'true' : 'false');
    saveAction(fd);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-ink-muted">
        Point the camera at the barcode on the box. Book barcodes are recognised and
        sent to the book flow instead.
      </p>
      {/* The viewfinder keeps a frame, and it is the shared one: a black
          rectangle on a dark theme has no edge of its own, and this is the
          one thing on the page that has to look like a live surface. */}
      <Card padding="none" className="overflow-hidden bg-black">
        <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
      </Card>
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

      {lastCode && <p className="font-mono text-body text-ink-muted">Last code: {lastCode}</p>}
      {searchPending && <p className="text-body text-ink-muted">Looking up barcode…</p>}
      <FieldError>{cameraError ?? searchState.error ?? saveState.error}</FieldError>

      {isbnHit && (
        <p className="text-body text-ink">
          That is a book barcode (ISBN {isbnHit}).{' '}
          <Link href="/shopping/inventory/add/books?mode=scan" className="text-accent underline">
            Scan it in Add books
          </Link>
          .
        </p>
      )}

      {saveState.message && (
        <p className="text-body text-accent">
          {saveState.message}{' '}
          {saveState.savedIds?.[0] && (
            <Link className="underline" href={`/shopping/inventory/${saveState.savedIds[0]}`}>
              View item
            </Link>
          )}
        </p>
      )}

      {shown && (
        <GameCard game={shown} onSave={save} onPick={setPicked} pending={savePending} />
      )}
      {!shown && !isbnHit && searchState.error && (
        <AddGameManualForm compact barcode={searchState.manualBarcode ?? lastCode} />
      )}
    </div>
  );
}
