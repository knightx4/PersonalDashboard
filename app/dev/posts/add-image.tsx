'use client';

import { ImagePlus } from 'lucide-react';
import { useRef, useState } from 'react';
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
 */
export function AddImage({
  room,
  onUploaded,
}: {
  room: number;
  onUploaded: (path: string, file: File) => Promise<string | undefined> | string | undefined | void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const pick = async (files: FileList | null) => {
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

  return (
    <div className="flex flex-col items-start gap-1">
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
        <ImagePlus className="size-3.5" aria-hidden />
        {busy ? 'Uploading…' : 'Add an image'}
      </Button>
      <FieldError>{error}</FieldError>
    </div>
  );
}
