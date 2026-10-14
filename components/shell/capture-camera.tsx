'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Camera, ScanBarcode, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, buttonVariants } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import type { CaptureKind, ScannedThing } from '@/lib/capture/actions';
import { PHOTO_ACCEPT, preparePhoto, UnsupportedImageError } from '@/lib/images/prepare-photo';

/**
 * The camera step inside aimed capture (plan #1950.3.2): a receipt photo an
 * order is read from, and a barcode naming the book or game to add. Each
 * takes the field's place while it is there, and Add makes the row from it
 * in one press. The pieces are drawn by the live panel through
 * `useCaptureCamera` and by the gallery from fixtures.
 *
 * The scanner reads on the device: only the decoded number goes to the
 * server, to name the thing before Add is pressed.
 */

/** Take or choose a receipt photo: the camera on a phone, the files on a computer. */
export function ReceiptPhotoButton({
  taken,
  onFile,
}: {
  taken: boolean;
  onFile: (file: File) => void;
}) {
  return (
    // The native input sits inside the label, so one press opens the camera
    // or the photo library with no field of its own to fill.
    <label
      className={cn(
        buttonVariants({ variant: 'ghost', size: 'sm' }),
        'cursor-pointer focus-within:ring-2 focus-within:ring-accent/40',
      )}
    >
      <Camera className="size-3.5" strokeWidth={1.75} aria-hidden />
      {taken ? 'Another photo' : 'Receipt photo'}
      <input
        type="file"
        accept={PHOTO_ACCEPT}
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

/** Start or stop the barcode scanner. */
export function ScanButton({ scanning, onStart, onStop }: { scanning: boolean; onStart: () => void; onStop: () => void }) {
  return scanning ? (
    <Button type="button" variant="ghost" size="sm" onClick={onStop}>
      <X className="size-3.5" strokeWidth={1.75} aria-hidden />
      Stop scanning
    </Button>
  ) : (
    <Button type="button" variant="ghost" size="sm" onClick={onStart}>
      <ScanBarcode className="size-3.5" strokeWidth={1.75} aria-hidden />
      Scan a barcode
    </Button>
  );
}

/** The ✕ that puts the field back, in the corner of what took its place. */
function TypeInstead({ onRemove, label }: { onRemove: () => void; label: string }) {
  return (
    <Tooltip label={label}>
      <IconButton label={label} size="sm" onClick={onRemove} className="shrink-0">
        <X strokeWidth={1.75} aria-hidden />
      </IconButton>
    </Tooltip>
  );
}

/** The receipt photo, where the field was, until Add reads it. */
export function ReceiptAttached({ src, onRemove }: { src: string; onRemove: () => void }) {
  return (
    <div className="flex items-start gap-3 px-3 py-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the device, not a remote image */}
      <img
        src={src}
        alt="The receipt photo"
        className="h-28 w-auto max-w-2/5 shrink-0 rounded-control bg-sunken object-contain"
      />
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-body text-ink">Receipt photo</p>
        <p className="text-small text-ink-muted">Add reads the shop, the day and each line, and opens the order.</p>
      </div>
      <TypeInstead onRemove={onRemove} label="Type it instead" />
    </div>
  );
}

/** An aiming frame over the live picture. */
const AIM_FRAME = 'pointer-events-none absolute inset-x-[18%] inset-y-[30%] rounded-control border border-white/70'; // ui-ok: hand-rolled-box -- an aiming mark drawn over the camera's picture, not a container

/**
 * The live viewfinder. The black ground is the camera's own and stays black
 * in either theme, since it is the one thing in the panel that has to look
 * like a live picture.
 */
export function Viewfinder({ videoRef }: { videoRef?: RefObject<HTMLVideoElement | null> }) {
  return (
    <div className="px-3 py-3">
      <div className="relative overflow-hidden rounded-control bg-black">
        <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
        {/* Where to hold the barcode: a frame, and the line under it says it. */}
        <div aria-hidden className={AIM_FRAME} />
      </div>
      <p className="mt-2 text-small text-ink-muted">Hold the barcode inside the frame. A book&rsquo;s is on the back cover.</p>
    </div>
  );
}

/** The scan landed and its number is being looked up. */
export function NamingCode({ code }: { code: string }) {
  return (
    <div className="px-3 py-3" aria-live="polite">
      <p className="text-body text-ink-muted">
        Looking up <span className="tabular text-ink">{code}</span>…
      </p>
    </div>
  );
}

/** What the scan named, where the field was, until Add adds it. */
export function ScannedAttached({ thing, onRemove }: { thing: ScannedThing; onRemove: () => void }) {
  return (
    <div className="flex items-start gap-3 px-3 py-3">
      {thing.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- a catalog's cover, from any host
        <img
          src={thing.image}
          alt=""
          className="h-16 w-12 shrink-0 rounded-control bg-sunken object-cover"
        />
      ) : (
        <span aria-hidden className="flex h-16 w-12 shrink-0 items-center justify-center rounded-control bg-sunken">
          <ScanBarcode className="size-4 text-ink-ghost" strokeWidth={1.75} />
        </span>
      )}
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="line-clamp-2 text-body text-ink">{thing.title}</p>
        {thing.byline && <p className="truncate text-small text-ink-muted">{thing.byline}</p>}
        <p className="text-small text-ink-muted">
          {thing.kind === 'book' ? 'Book' : 'Board game'} · <span className="tabular">{thing.code}</span>
        </p>
      </div>
      <TypeInstead onRemove={onRemove} label="Type it instead" />
    </div>
  );
}

type Named = { ok: true; thing: ScannedThing } | { ok: false; error: string };

/**
 * The camera step's state for the live panel: what takes the field's place,
 * the button in the foot, and what Add sends. `name` looks a scanned code up
 * on the server; `onError` puts a failure where the panel shows its errors.
 */
export function useCaptureCamera(
  kind: CaptureKind,
  name: (code: string) => Promise<Named>,
  onError: (error: string | null) => void,
) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [scanned, setScanned] = useState<ScannedThing | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);

  const stop = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  }, []);

  // The camera goes off when the panel closes.
  useEffect(() => () => controlsRef.current?.stop(), []);

  async function onFile(file: File) {
    onError(null);
    try {
      const { dataUrl } = await preparePhoto(file);
      setPhoto(dataUrl);
    } catch (error) {
      setPhoto(null);
      onError(error instanceof UnsupportedImageError ? error.message : 'That photo could not be read. Try another.');
    }
  }

  // The viewfinder has to be on screen before the reader can draw into it, so
  // the reader starts once `scanning` has rendered the video element.
  useEffect(() => {
    if (!scanning || !videoRef.current || controlsRef.current) return;
    let live = true;
    (async () => {
      try {
        // Loaded on the press: the shell carries this panel on every page.
        const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        if (!live || !videoRef.current) return;
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
        ]);
        const reader = new BrowserMultiFormatReader(hints);
        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result, _err, running) => {
          if (!result) return;
          running.stop();
          controlsRef.current = null;
          setScanning(false);
          const code = result.getText();
          setNaming(code);
          name(code)
            .then((named) => {
              if (named.ok) setScanned(named.thing);
              else onError(named.error);
            })
            .catch(() => onError('The catalogs did not answer just now. Try again, or type the name.'))
            .finally(() => setNaming(null));
        });
        if (live) controlsRef.current = controls;
        else controls.stop();
      } catch (error) {
        setScanning(false);
        onError(
          error instanceof Error && error.name === 'NotAllowedError'
            ? 'The camera is blocked. Allow it for this site, or type the name.'
            : 'The camera could not be opened. Type the name instead.',
        );
      }
    })();
    return () => {
      live = false;
    };
  }, [scanning, name, onError]);

  const clear = () => {
    setPhoto(null);
    setScanned(null);
  };

  let attached: React.ReactNode = null;
  if (photo) attached = <ReceiptAttached src={photo} onRemove={clear} />;
  else if (scanning) attached = <Viewfinder videoRef={videoRef} />;
  else if (naming) attached = <NamingCode code={naming} />;
  else if (scanned) attached = <ScannedAttached thing={scanned} onRemove={clear} />;

  let tools: React.ReactNode = null;
  if (kind.camera === 'receipt') tools = <ReceiptPhotoButton taken={photo !== null} onFile={onFile} />;
  if (kind.camera === 'barcode') {
    tools = (
      <ScanButton
        scanning={scanning}
        onStart={() => {
          onError(null);
          setScanned(null);
          setScanning(true);
        }}
        onStop={stop}
      />
    );
  }

  return {
    attached,
    tools,
    photo: kind.camera === 'receipt' ? photo : null,
    scanned: kind.camera === 'barcode' ? scanned : null,
    /** Scanning or looking up: Add waits for it. */
    busy: scanning || naming !== null,
  };
}
