'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AudioLines, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import Link from '@/components/ui/link';
import type { VoiceFilters } from '@/lib/talk/speech/voices-model';
import { SampleNote, SamplePress, VoicePicker, type VoicePageResult, type VoicePickerFixture } from './voice-picker';

/**
 * A bot's voice on its form (plan #3006.5): the Fish voice its replies are
 * read aloud in, so each bot sounds the same every time.
 *
 * The row shows only the voice in use, as a Choose voice button with a
 * sample to hear beside it (plan #3081). The button opens the picker's
 * pop-up (voice-picker.tsx), where Fish voices are searched, filtered and
 * sorted, a voice is pasted by its id or link, or the bot goes back to the
 * default voice, Dash's. Each change is kept as soon as it is made, apart
 * from the form's Save, as the picture is.
 *
 * A saved voice Fish no longer offers says "Voice unavailable, using
 * default"; replies fall back to the default by themselves. Without the
 * Fish key the row says to add it, with a link to the step that sets it.
 * A bot not yet added has nothing to keep a voice on, so the row is not drawn.
 */

export type BotVoice = { id: string; name: string | null };

export type BotVoiceActions = {
  list: (filters: VoiceFilters, page: number) => Promise<VoicePageResult>;
  save: (advisorId: string, voice: BotVoice | null) => Promise<{ voice: BotVoice | null } | { error: string }>;
};

/** Where the Fish key is set: #3006.4 on the plan. */
export const FISH_KEY_HREF = '/dev/plan/3006?tab=steps#plan-3018';

export type VoiceStatus = 'ok' | 'gone' | 'not-set' | 'unknown';

export function BotVoiceField({
  advisorId,
  botName,
  voice: initialVoice,
  status: initialStatus,
  actions,
  open: initialOpen = false,
  list: fixture = null,
  error: initialError = null,
}: {
  /** Empty for a bot not yet added. */
  advisorId: string;
  botName: string;
  voice: BotVoice | null;
  /** Whether Fish still offers the saved voice, and whether the key is set. */
  status: VoiceStatus;
  actions: BotVoiceActions;
  /** For the gallery: the picker open. */
  open?: boolean;
  /** For the gallery: what the open picker shows. */
  list?: VoicePickerFixture | null;
  /** For the gallery: a save that failed. */
  error?: string | null;
}) {
  const router = useRouter();
  const [voice, setVoice] = useState<BotVoice | null>(initialVoice);
  const [status, setStatus] = useState<VoiceStatus>(initialStatus);
  const [open, setOpen] = useState(initialOpen);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const close = useCallback(() => setOpen(false), []);

  const choose = async (next: BotVoice | null, key: string) => {
    setSaving(key);
    setError(null);
    const result = await actions.save(advisorId, next);
    setSaving(null);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setVoice(result.voice);
    setStatus('ok');
    setOpen(false);
    router.refresh();
  };

  if (!advisorId) return null;

  if (status === 'not-set') {
    return (
      <div>
        <p className="mb-1 text-ui font-medium text-ink">Voice</p>
        <p className="text-small text-ink-muted">
          <Link href={FISH_KEY_HREF} className="text-accent hover:underline">
            Add the Fish Audio key to choose voices
          </Link>
          . Until then {botName.trim() ? `${botName.trim()} speaks` : 'they speak'} in the default voice.
        </p>
      </div>
    );
  }

  const current = voice ? voice.name || 'A voice from fish.audio' : "Dash's default voice";

  return (
    <div>
      <p className="mb-1 text-ui font-medium text-ink">Voice</p>
      <div className="flex min-w-0 items-center gap-1.5">
        <Button
          type="button"
          variant="secondary"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Choose voice. Now: ${current}`}
          className="h-auto min-h-(--control-h) min-w-0 max-w-full justify-start py-1.5 text-left whitespace-normal"
          onClick={() => setOpen(true)}
        >
          <AudioLines aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-ink-muted" />
          <span className="min-w-0 break-words">{current}</span>
          <ChevronRight aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-ink-muted" />
        </Button>
        {status !== 'gone' && <SamplePress voice={{ id: voice?.id ?? '', name: current, author: '', sample: null }} botName={botName} />}
      </div>
      {voice && status === 'gone' && <p className="mt-1 text-small text-caution">Voice unavailable, using default</p>}
      <SampleNote id={voice?.id ?? ''} />
      {!open && <FieldError>{error}</FieldError>}

      {open && (
        <VoicePicker
          botName={botName}
          chosen={voice?.id ?? null}
          saving={saving}
          error={error}
          list={actions.list}
          onUse={(next, key) => void choose(next, key)}
          onClose={close}
          {...(fixture ? { fixture } : {})}
        />
      )}
    </div>
  );
}
