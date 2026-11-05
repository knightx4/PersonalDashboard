'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageUp } from 'lucide-react';
import { PersonMark } from '@/components/patterns/messaging';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { BOT_PHOTO_ACCEPT } from '@/lib/you/bot-photos-model';

/**
 * A bot's picture on its form (plan #2955): the picture as Chat draws it,
 * Upload a picture (or Change picture) to choose an image of the person's
 * own, and Remove to go back to their initials. Each change is kept
 * as soon as it is made, apart from the form's Save. A bot not yet added has
 * no folder for a picture, so the row is not drawn; the form says under its
 * colours that a picture can be added once they are.
 */

export type BotPhotoActions = {
  /** Put the file in the bot's folder; the path it was kept at. */
  upload: (advisorId: string, file: File) => Promise<{ path: string } | { error: string }>;
  /** Point the bot at that path, or at none with null. */
  save: (advisorId: string, path: string | null) => Promise<{ error: string | null }>;
};

export function BotPhotoField({
  advisorId,
  initials,
  colour,
  photo,
  onPhoto,
  actions,
  busy: initialBusy = false,
  error: initialError = null,
}: {
  /** Empty for a bot not yet added. */
  advisorId: string;
  initials: string;
  colour: string;
  photo: string | null;
  /** The picture now shown, for the form's header to match. */
  onPhoto: (photo: string | null) => void;
  actions: BotPhotoActions;
  /** For the gallery: an upload under way. */
  busy?: boolean;
  /** For the gallery: an upload that failed. */
  error?: string | null;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(initialBusy ? 'upload' : null);
  const [error, setError] = useState<string | null>(initialError);
  const adding = !advisorId;

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy('upload');
    setError(null);
    const uploaded = await actions.upload(advisorId, file);
    if ('error' in uploaded) {
      setBusy(null);
      setError(uploaded.error);
      return;
    }
    const saved = await actions.save(advisorId, uploaded.path);
    setBusy(null);
    if (saved.error) {
      setError(saved.error);
      return;
    }
    onPhoto(URL.createObjectURL(file));
    router.refresh();
  };

  const remove = async () => {
    setBusy('remove');
    setError(null);
    const saved = await actions.save(advisorId, null);
    setBusy(null);
    if (saved.error) {
      setError(saved.error);
      return;
    }
    onPhoto(null);
    router.refresh();
  };

  // A bot not yet added has no folder for a picture; the form says so under its colours.
  if (adding) return null;

  return (
    <div>
      <p className="mb-1 text-ui font-medium text-ink">Picture</p>
      <div className="flex items-center gap-3">
        <span className={busy === 'upload' ? 'opacity-60 transition-opacity duration-quick' : undefined}>
          <PersonMark initials={initials} colour={colour} photo={photo} size="lg" />
        </span>
        <div className="flex min-w-0 flex-col items-start gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" pending={busy === 'upload'} disabled={busy !== null} onClick={() => input.current?.click()}>
              <ImageUp aria-hidden strokeWidth={1.75} />
              {busy === 'upload' ? 'Uploading…' : photo ? 'Change picture' : 'Upload a picture'}
            </Button>
            {photo && (
              <Button type="button" variant="ghost" size="sm" aria-label="Remove picture" pending={busy === 'remove'} disabled={busy !== null} onClick={remove}>
                Remove
              </Button>
            )}
          </div>
          <p className="text-small text-ink-muted">PNG, JPEG, WebP or GIF, up to 5 MB.</p>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept={BOT_PHOTO_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose a picture"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          void choose(file);
        }}
      />
      <FieldError>{error}</FieldError>
    </div>
  );
}
