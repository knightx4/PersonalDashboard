'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AudioLines, Play, Search, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldError, Input, PressLabel } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import Link from '@/components/ui/link';
import { Tooltip } from '@/components/ui/tooltip';
import { useSpeechNote, useVoiceSample } from '@/components/talk/speak-reply';
import { cn } from '@/lib/cn';
import { sampleLine, voiceIdOf, type FishVoice, type VoiceList } from '@/lib/talk/speech/voices-model';

/**
 * A bot's voice on its form (plan #3006.5): the Fish voice its replies are
 * read aloud in, so each bot sounds the same every time.
 *
 * Choose a voice opens the picker: a search over Fish's public library, the
 * person's own voices on their Fish account listed first, each with a sample
 * to hear and Use. A voice found on fish.audio can be pasted by its id or
 * its link. Use default clears it, and the bot speaks in the default voice,
 * Dash's. Each change is kept as soon as it is made, apart from the form's
 * Save, as the picture is.
 *
 * A saved voice Fish no longer offers says "Voice unavailable, using
 * default"; replies fall back to the default by themselves. Without the
 * Fish key the row says to add it, with a link to the step that sets it.
 * A bot not yet added has nothing to keep a voice on, so the row is not drawn.
 */

export type BotVoice = { id: string; name: string | null };

export type VoiceListResult = ({ configured: true } & VoiceList) | { configured: false } | { error: string };

export type BotVoiceActions = {
  list: (search: string) => Promise<VoiceListResult>;
  save: (advisorId: string, voice: BotVoice | null) => Promise<{ voice: BotVoice | null } | { error: string }>;
};

/** Where the Fish key is set: #3006.4 on the plan. */
export const FISH_KEY_HREF = '/dev/plan/3006?tab=steps#plan-3018';

export type VoiceStatus = 'ok' | 'gone' | 'not-set' | 'unknown';

const SEARCH_WAIT_MS = 350;

export function BotVoiceField({
  advisorId,
  botName,
  voice: initialVoice,
  status: initialStatus,
  actions,
  open: initialOpen = false,
  list: initialList = null,
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
  /** For the gallery: the voices the picker shows. */
  list?: VoiceList | null;
  /** For the gallery: a save that failed. */
  error?: string | null;
}) {
  const router = useRouter();
  const [voice, setVoice] = useState<BotVoice | null>(initialVoice);
  const [status, setStatus] = useState<VoiceStatus>(initialStatus);
  const [open, setOpen] = useState(initialOpen);
  const [search, setSearch] = useState('');
  const [list, setList] = useState<VoiceList | null>(initialList);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const asked = useRef(0);
  const gallery = initialList !== null;

  useEffect(() => {
    if (!open || gallery || status === 'not-set') return;
    const ask = ++asked.current;
    const timer = setTimeout(
      async () => {
        setLoading(true);
        setListError(null);
        const result = await actions.list(search);
        if (ask !== asked.current) return;
        setLoading(false);
        if ('error' in result) setListError(result.error);
        else if (!result.configured) setStatus('not-set');
        else setList({ mine: result.mine, library: result.library });
      },
      search ? SEARCH_WAIT_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [open, search, gallery, status, actions]);

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
    setPasted('');
    if (result.voice) setOpen(false);
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

  const pastedId = voiceIdOf(pasted);
  const current = voice ? voice.name || 'A voice from fish.audio' : "Dash's default voice";

  return (
    <div>
      <p className="mb-1 text-ui font-medium text-ink">Voice</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex min-w-0 items-center gap-2 text-ui text-ink">
          <AudioLines aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-ink-muted" />
          <span className="truncate">{current}</span>
          {voice && status !== 'gone' && <SamplePress voice={{ id: voice.id, name: current, author: '', sample: null }} botName={botName} />}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? 'Close' : voice ? 'Change voice' : 'Choose a voice'}
          </Button>
          {voice && (
            <Button type="button" variant="ghost" size="sm" pending={saving === 'default'} disabled={saving !== null} onClick={() => void choose(null, 'default')}>
              Use default
            </Button>
          )}
        </div>
      </div>
      {voice && status === 'gone' && <p className="mt-1 text-small text-caution">Voice unavailable, using default</p>}
      {voice && <SampleNote id={voice.id} />}
      <FieldError>{error}</FieldError>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="relative">
            <Search aria-hidden strokeWidth={1.75} className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
            <PressLabel htmlFor="bot-voice-search" />
            <Input
              id="bot-voice-search"
              type="search"
              aria-label="Search Fish voices"
              placeholder="Search Fish voices"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
              autoComplete="off"
            />
          </div>
          {listError ? (
            <p className="text-small text-danger">{listError}</p>
          ) : !list ? (
            <p className="text-small text-ink-muted" aria-live="polite">
              {loading ? 'Finding voices…' : ''}
            </p>
          ) : (
            <div className={cn('flex flex-col gap-3', loading && 'opacity-60 transition-opacity duration-quick')} aria-busy={loading}>
              {list.mine.length > 0 && <VoiceGroup title="Your voices" voices={list.mine} chosen={voice?.id ?? null} saving={saving} botName={botName} onUse={(v) => void choose({ id: v.id, name: v.name }, v.id)} />}
              <VoiceGroup
                title="Fish library"
                voices={list.library}
                chosen={voice?.id ?? null}
                saving={saving}
                botName={botName}
                empty={search.trim() ? `No voices called “${search.trim()}”.` : 'No voices to show.'}
                onUse={(v) => void choose({ id: v.id, name: v.name }, v.id)}
              />
            </div>
          )}
          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <label htmlFor="bot-voice-id" className="text-small text-ink-muted">
              Found one on fish.audio? Paste its ID or link.
            </label>
            <div className="flex gap-2">
              <Input id="bot-voice-id" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Voice ID or link" autoComplete="off" className="min-w-0 flex-1" />
              <Button
                type="button"
                variant="secondary"
                disabled={!pastedId || saving !== null}
                pending={saving === 'pasted'}
                onClick={() => pastedId && void choose({ id: pastedId, name: null }, 'pasted')}
              >
                Use
              </Button>
            </div>
            {pasted.trim() && !pastedId && <p className="text-small text-ink-muted">That is not a voice ID or a fish.audio voice link.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function VoiceGroup({
  title,
  voices,
  chosen,
  saving,
  botName,
  empty,
  onUse,
}: {
  title: string;
  voices: readonly FishVoice[];
  chosen: string | null;
  saving: string | null;
  botName: string;
  empty?: string;
  onUse: (voice: FishVoice) => void;
}) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1 text-small font-medium text-ink-muted">{title}</h3>
      {voices.length === 0 ? (
        <p className="text-small text-ink-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col">
          {voices.map((v) => (
            <li key={v.id} className="flex flex-col gap-0.5 py-1.5">
              <div className="flex items-center gap-2">
                <SamplePress voice={v} botName={botName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui text-ink">{v.name}</p>
                  {v.author && <p className="truncate text-small text-ink-muted">by {v.author}</p>}
                </div>
                {chosen === v.id ? (
                  <span className="shrink-0 px-2 text-small text-ink-muted">In use</span>
                ) : (
                  <Button type="button" variant="ghost" size="sm" aria-label={`Use ${v.name}`} pending={saving === v.id} disabled={saving !== null} onClick={() => onUse(v)}>
                    Use
                  </Button>
                )}
              </div>
              <SampleNote id={v.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Play a voice's sample: Fish's own recording, or a line spoken in it (counted against the month). */
function SamplePress({ voice, botName }: { voice: FishVoice; botName: string }) {
  const sample = useVoiceSample(`voice-sample:${voice.id}`);
  const label = sample.busy ? 'Stop the sample' : `Play a sample of ${voice.name}`;
  return (
    <Tooltip label={label}>
      <IconButton
        size="sm"
        label={label}
        aria-pressed={sample.busy}
        active={sample.busy}
        onClick={() => sample.toggle({ url: voice.sample, line: sampleLine(botName), voice: voice.id })}
      >
        {sample.busy ? <Square strokeWidth={1.75} fill="currentColor" aria-hidden /> : <Play strokeWidth={1.75} aria-hidden />}
      </IconButton>
    </Tooltip>
  );
}

function SampleNote({ id }: { id: string }) {
  const note = useSpeechNote(`voice-sample:${id}`);
  return note ? (
    <p role="status" className="text-small text-ink-muted">
      {note}
    </p>
  ) : null;
}
