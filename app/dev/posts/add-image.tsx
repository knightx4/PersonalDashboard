'use client';

import { ImagePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { filesFromPaste } from '@/components/attachments/add-file';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { POST_IMAGE_TYPES } from '@/lib/dev/posts';
import { uploadPostImage } from './upload-image';

/**
 * "Add an image": a button that opens the file picker, uploads what was
 * picked to the person's folder of the post-images bucket, and hands each
 * path to `onUploaded`. Used by Write your own, before the draft exists, and
 * by a waiting draft, which records the path straight away.
 *
 * `room` is how many more images the post can take, so picking five at once
 * keeps the first ones that fit and says the rest were left out.
 *
 * A picture pasted anywhere in the same draft, the form or the post's row,
 * goes in as if it had been picked (note 90153e80). A paste that carries text
 * is left to the box it was pasted into.
 */
export function AddImage({
  room,
  onUploaded,
}: {
  room: number;
  onUploaded: (path: string, file: File) => Promise<string | undefined> | string | undefined | void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const pick = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(undefined);
    const chosen = Array.from(files);
    let problem: string | undefined =
      chosen.length > room ? `A post takes four images, so only the first ${room} were added.` : undefined;
    for (const file of chosen.slice(0, room)) {
      const uploaded = await uploadPostImage(file);
      if ('error' in uploaded) {
        problem = uploaded.error;
        break;
      }
      const failed = await onUploaded(uploaded.path, file);
      if (failed) {
        problem = failed;
        break;
      }
    }
    setError(problem);
    setBusy(false);
    if (input.current) input.current.value = '';
  };

  // The latest pick and room for the listener, which is attached once.
  const latest = useRef({ pick, room, busy });
  useEffect(() => {
    latest.current = { pick, room, busy };
  });

  useEffect(() => {
    const scope = box.current?.closest('form, li');
    if (!scope) return;
    // A paste goes to whatever has focus, and pressing plain text in the
    // draft leaves it on the page, so the last press inside counts too.
    let pressedInside = false;
    const onDown = (event: PointerEvent) => {
      pressedInside = event.target instanceof Node && scope.contains(event.target);
    };
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      const inside = target ? scope.contains(target) : false;
      if (!inside && !(pressedInside && target === document.body)) return;
      const { pick: add, room: left, busy: uploading } = latest.current;
      if (!event.clipboardData || event.defaultPrevented || uploading || left <= 0) return;
      const images = filesFromPaste(event.clipboardData, 0).filter((file) => POST_IMAGE_TYPES.includes(file.type));
      if (images.length === 0) return;
      event.preventDefault();
      void add(images);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  return (
    <div ref={box} className="flex flex-col items-start gap-1">
      <input
        ref={input}
        type="file"
        accept={POST_IMAGE_TYPES.join(',')}
        multiple
        hidden
        onChange={(event) => void pick(event.target.files)}
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        pending={busy}
        disabled={room <= 0}
        onClick={() => input.current?.click()}
      >
        <ImagePlus strokeWidth={1.75} className="size-3.5" aria-hidden />
        {busy ? 'Uploading…' : 'Add an image'}
      </Button>
      <FieldError>{error}</FieldError>
    </div>
  );
}
