'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, Search, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Chip, ToggleChip } from '@/components/ui/chip';
import { FieldError, Input, PressLabel, Select } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { scrim } from '@/components/ui/popover';
import { Tooltip } from '@/components/ui/tooltip';
import { useSpeechNote, useVoiceSample } from '@/components/talk/speak-reply';
import { cn } from '@/lib/cn';
import {
  DEFAULT_VOICE_FILTERS,
  VOICE_LANGUAGES,
  VOICE_SORTS,
  VOICE_STYLE_TAGS,
  filtersActive,
  filtersOf,
  languageName,
  sampleLine,
  voiceIdOf,
  type FishVoice,
  type VoiceFilters,
  type VoiceGender,
  type VoicePage,
  type VoiceSort,
  usesLabel,
} from '@/lib/talk/speech/voices-model';
import { formatNumber } from '@/lib/money';

/**
 * The Fish voice picker's pop-up (plan #3081), opened from Choose voice on a
 * bot's form: a modal on a laptop, a full-height sheet on a phone.
 *
 * A search over voice titles, then the filters Fish's list takes: gender
 * and style tags (the uploader's own, so an untagged voice shows only under
 * Any), a language with English first, the person's own voices only
 * (Mine), and the order (most used, newest, relevance). Each change asks
 * the app's server again, which asks Fish with the key it keeps; a search
 * waits until typing stops. The filters last for the browser session.
 *
 * Each voice shows its name, tags, language and how often it is used, with
 * a sample to hear and Use this voice, which saves it on the bot and closes
 * the pop-up. Show more voices fetches the next page. At the foot, a voice
 * found on fish.audio can be pasted by its id or link, and Use Dash's voice
 * puts the bot back on the default.
 */

export type VoicePageResult = ({ configured: true } & VoicePage) | { configured: false } | { error: string };

/** The gallery's picture of the pop-up: the page it lists and the filters set. */
export type VoicePickerFixture = { page: VoicePage | null; filters?: VoiceFilters; loading?: boolean };

const SEARCH_WAIT_MS = 350;
const FILTERS_KEY = 'bot-voice-filters';

function readFilters(): VoiceFilters {
  try {
    const kept = sessionStorage.getItem(FILTERS_KEY);
    return kept ? filtersOf(JSON.parse(kept)) : DEFAULT_VOICE_FILTERS;
  } catch {
    return DEFAULT_VOICE_FILTERS;
  }
}

function keepFilters(filters: VoiceFilters) {
  try {
    sessionStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // A private window keeps nothing; the filters still work for this pop-up.
  }
}

const GENDERS: readonly { value: VoiceGender; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

export function VoicePicker({
  botName,
  chosen,
  saving,
  error,
  list,
  onUse,
  onClose,
  fixture,
}: {
  botName: string;
  /** The voice the bot has now, marked In use; null for the default. */
  chosen: string | null;
  /** The key of the save under way: a voice id, 'pasted' or 'default'. */
  saving: string | null;
  error: string | null;
  list: (filters: VoiceFilters, page: number) => Promise<VoicePageResult>;
  onUse: (voice: { id: string; name: string | null } | null, key: string) => void;
  onClose: () => void;
  /** For the gallery: drawn as given, and nothing is asked. */
  fixture?: VoicePickerFixture;
}) {
  const gallery = fixture !== undefined;
  const [filters, setFilters] = useState<VoiceFilters>(() => fixture?.filters ?? (gallery ? DEFAULT_VOICE_FILTERS : readFilters()));
  const [page, setPage] = useState<VoicePage | null>(fixture?.page ?? null);
  const [pageNumber, setPageNumber] = useState(1);
  const [loading, setLoading] = useState(fixture?.loading ?? false);
  const [listError, setListError] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const asked = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastSearch = useRef(filters.search);

  useEffect(() => {
    if (gallery) return;
    keepFilters(filters);
    const typed = filters.search !== lastSearch.current;
    lastSearch.current = filters.search;
    const ask = ++asked.current;
    const timer = setTimeout(
      async () => {
        setLoading(true);
        setListError(null);
        const result = await list(filters, 1).catch(() => ({ error: 'The voices could not be listed. Try again in a moment.' }));
        if (ask !== asked.current) return;
        setLoading(false);
        if ('error' in result) setListError(result.error);
        else if (!result.configured) setListError('The Fish Audio key is not set, so no voices can be listed.');
        else {
          setPage({ voices: result.voices, total: result.total, more: result.more });
          setPageNumber(1);
        }
      },
      typed ? SEARCH_WAIT_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [filters, gallery, list]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!gallery) searchRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, gallery]);

  const more = async () => {
    if (gallery || !page) return;
    const ask = ++asked.current;
    setLoading(true);
    const next = pageNumber + 1;
    const result = await list(filters, next).catch(() => ({ error: 'More voices could not be listed. Try again.' }));
    if (ask !== asked.current) return;
    setLoading(false);
    if ('error' in result) setListError(result.error);
    else if (result.configured) {
      const seen = new Set(page.voices.map((v) => v.id));
      setPage({ voices: [...page.voices, ...result.voices.filter((v) => !seen.has(v.id))], total: result.total, more: result.more });
      setPageNumber(next);
    }
  };

  const set = (change: Partial<VoiceFilters>) => setFilters((f) => ({ ...f, ...change }));
  const toggleTag = (tag: string) => set({ tags: filters.tags.includes(tag) ? filters.tags.filter((t) => t !== tag) : [...filters.tags, tag] });
  const pastedId = voiceIdOf(pasted);
  const name = botName.trim();
  const search = filters.search.trim();

  const panel = (
    <div className="fixed inset-0 z-overlay flex md:items-center md:justify-center md:p-6">
      <button type="button" aria-label="Close the voice picker" tabIndex={-1} onClick={onClose} className={scrim} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-picker-title"
        /* ui-ok: the pop-up's own edge on a laptop, a floating panel with nothing behind it to separate it from */
        className="relative flex h-full w-full flex-col bg-surface pt-[env(safe-area-inset-top)] md:h-auto md:max-h-[min(46rem,calc(100dvh-3rem))] md:max-w-xl md:rounded-card md:border md:border-border md:pt-0 md:shadow-lg"
      >
        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
          <h2 id="voice-picker-title" className="min-w-0 truncate text-title font-semibold text-ink">
            {name ? `A voice for ${name}` : 'Choose a voice'}
          </h2>
          <Tooltip label="Close">
            <IconButton label="Close the voice picker" onClick={onClose}>
              <X strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
        </div>
        <div className="relative px-4 pb-3">
          <Search aria-hidden strokeWidth={1.75} className="pointer-events-none absolute top-[calc(50%-0.375rem)] left-6.5 size-4 -translate-y-1/2 text-ink-muted" />
          <PressLabel htmlFor="voice-picker-search" />
          <Input
            ref={searchRef}
            id="voice-picker-search"
            type="search"
            aria-label="Search Fish voices by name"
            placeholder="Search Fish voices by name"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            className="relative pl-8"
            autoComplete="off"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          <div className="flex flex-col gap-2.5 border-b border-border pb-3">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Gender">
              {GENDERS.map((g) => (
                <ToggleChip key={g.value} on={filters.gender === g.value} onClick={() => set({ gender: g.value })}>
                  {g.label}
                </ToggleChip>
              ))}
              <span aria-hidden className="mx-1 h-4 w-px bg-border" />
              <ToggleChip on={filters.mine} onClick={() => set({ mine: !filters.mine })} title="Only voices you cloned or own on Fish">
                Mine
              </ToggleChip>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Style">
              {[...new Set([...VOICE_STYLE_TAGS, ...filters.tags])].map((tag) => (
                <ToggleChip key={tag} on={filters.tags.includes(tag)} onClick={() => toggleTag(tag)}>
                  {tag}
                </ToggleChip>
              ))}
            </div>
            <p className="text-small text-ink-muted">Tags are set by the uploader, so untagged voices only appear under Any.</p>
            <div className="flex flex-wrap gap-2">
              <label className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-small text-ink-muted">
                Language
                <Select value={filters.language ?? ''} onChange={(e) => set({ language: e.target.value || null })}>
                  <option value="">Any language</option>
                  {VOICE_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-small text-ink-muted">
                Sort by
                <Select value={filters.sort} onChange={(e) => set({ sort: e.target.value as VoiceSort })}>
                  {VOICE_SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          </div>

          <div className="flex min-h-9 items-center justify-between gap-3 pt-2" aria-live="polite">
            <p className="text-small text-ink-muted">
              {listError ? '' : page ? `${formatNumber(page.total)} ${page.total === 1 ? 'voice' : 'voices'}` : loading ? 'Finding voices…' : ''}
            </p>
            {filtersActive(filters) && (
              <Button type="button" variant="link" onClick={() => setFilters(DEFAULT_VOICE_FILTERS)}>
                Clear filters
              </Button>
            )}
          </div>
          <FieldError>{error}</FieldError>
          {listError ? (
            <p className="py-2 text-small text-danger">{listError}</p>
          ) : page && page.voices.length === 0 ? (
            <p className="py-4 text-ui text-ink-muted">
              {search ? `No voices called “${search}” with these filters.` : 'No voices with these filters.'}
            </p>
          ) : page ? (
            <ul className={cn('flex flex-col', loading && 'opacity-60 transition-opacity duration-quick')} aria-busy={loading}>
              {page.voices.map((v) => (
                <VoiceRow key={v.id} voice={v} botName={botName} chosen={chosen === v.id} saving={saving} onUse={() => onUse({ id: v.id, name: v.name }, v.id)} />
              ))}
            </ul>
          ) : null}
          {page?.more && !listError && (
            <div className="flex justify-center pt-2">
              <Button type="button" variant="secondary" size="sm" pending={loading} onClick={() => void more()}>
                Show more voices
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5 border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <label htmlFor="voice-picker-id" className="text-small text-ink-muted">
            Found one on fish.audio? Paste its ID or link.
          </label>
          <div className="flex gap-2">
            <Input id="voice-picker-id" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Voice ID or link" autoComplete="off" className="min-w-0 flex-1" />
            <Button
              type="button"
              variant="secondary"
              disabled={!pastedId || saving !== null}
              pending={saving === 'pasted'}
              onClick={() => pastedId && onUse({ id: pastedId, name: null }, 'pasted')}
            >
              Use
            </Button>
          </div>
          {pasted.trim() && !pastedId && <p className="text-small text-ink-muted">That is not a voice ID or a fish.audio voice link.</p>}
          {chosen && (
            <Button type="button" variant="link" className="self-start" disabled={saving !== null} onClick={() => onUse(null, 'default')}>
              {saving === 'default' ? 'Going back to Dash’s voice…' : 'Use Dash’s default voice instead'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? null : createPortal(panel, document.body);
}

function VoiceRow({ voice, botName, chosen, saving, onUse }: { voice: FishVoice; botName: string; chosen: boolean; saving: string | null; onUse: () => void }) {
  const languages = (voice.languages ?? []).map(languageName);
  const uses = usesLabel(voice.uses);
  const facts = [languages.slice(0, 2).join(', '), voice.author ? `by ${voice.author}` : '', uses ?? ''].filter(Boolean);
  return (
    <li className="flex flex-col gap-0.5 border-b border-border py-2.5 last:border-b-0">
      <div className="flex items-start gap-2">
        <SamplePress voice={voice} botName={botName} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-ui font-medium break-words text-ink">{voice.name}</p>
          {facts.length > 0 && <p className="tabular truncate text-small text-ink-muted">{facts.join(' · ')}</p>}
          {voice.tags && voice.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {voice.tags.slice(0, 5).map((tag) => (
                <Chip key={tag} size="sm" className="max-w-full">
                  <span className="min-w-0 truncate">{tag}</span>
                </Chip>
              ))}
            </div>
          )}
        </div>
        {chosen ? (
          <span className="shrink-0 px-2 py-1 text-small text-ink-muted">In use</span>
        ) : (
          <Button type="button" variant="secondary" size="sm" className="shrink-0" aria-label={`Use this voice: ${voice.name}`} pending={saving === voice.id} disabled={saving !== null} onClick={onUse}>
            <span className="max-sm:hidden">Use this voice</span>
            <span className="sm:hidden">Use</span>
          </Button>
        )}
      </div>
      <SampleNote id={voice.id} />
    </li>
  );
}

/** Play a voice's sample: Fish's own recording, or a line spoken in it (counted against the month). */
export function SamplePress({ voice, botName }: { voice: FishVoice; botName: string }) {
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

export function SampleNote({ id }: { id: string }) {
  const note = useSpeechNote(`voice-sample:${id}`);
  return note ? (
    <p role="status" className="text-small text-ink-muted">
      {note}
    </p>
  ) : null;
}
