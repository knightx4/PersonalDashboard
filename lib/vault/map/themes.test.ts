import { describe, expect, it, vi } from 'vitest';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import {
  loadNearestThemeNames,
  MAX_EXISTING_THEMES,
  NEAREST_THEMES_OFFERED,
  NOTE_EMBED_CHARS,
  noteEmbeddingText,
  offerThemes,
} from './themes';

/**
 * Which theme names a note is offered before it is read (plan #818): the
 * themes nearest it by embedding, then the strongest. The embedding call and
 * the database are stubs; what is checked is the order, the cap, and that a
 * failure anywhere leaves the strongest list as it was.
 */

const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));

const embedded = vi.fn(async () => ({
  ok: true as const,
  vectors: [vector],
  model: 'voyage-4-lite',
  tokens: 12,
}));

function db(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn(async () => result);
  return { supabase: { rpc } as unknown as VaultSupabaseClient, rpc };
}

const NOTE = { title: 'Fifteen-minute neighbourhoods', body: 'Everything you need within a walk.' };

describe('offerThemes', () => {
  it('puts the nearest first and fills to the cap with the strongest, once each', () => {
    const strongest = Array.from({ length: 300 }, (_, i) => `Strong ${i}`);
    const offered = offerThemes(['Walkability', 'Strong 5'], strongest);
    expect(offered.slice(0, 3)).toEqual(['Walkability', 'Strong 5', 'Strong 0']);
    expect(offered).toHaveLength(MAX_EXISTING_THEMES);
    expect(offered.filter((name) => name === 'Strong 5')).toHaveLength(1);
  });

  it('keeps room for the strongest however many nearest come back', () => {
    const nearest = Array.from({ length: 200 }, (_, i) => `Near ${i}`);
    const offered = offerThemes(nearest, ['Housing']);
    expect(offered.filter((name) => name.startsWith('Near '))).toHaveLength(NEAREST_THEMES_OFFERED);
    expect(offered).toContain('Housing');
  });

  it('is the strongest list unchanged when there are no nearest names', () => {
    const strongest = Array.from({ length: 250 }, (_, i) => `Strong ${i}`);
    expect(offerThemes([], strongest)).toEqual(strongest.slice(0, MAX_EXISTING_THEMES));
  });
});

describe('noteEmbeddingText', () => {
  it('is the title and the opening of the body', () => {
    const text = noteEmbeddingText({ title: 'T', body: 'x'.repeat(NOTE_EMBED_CHARS * 2) });
    expect(text.startsWith('T\n\nxxx')).toBe(true);
    expect(text).toHaveLength(NOTE_EMBED_CHARS);
  });
});

describe('loadNearestThemeNames', () => {
  it('embeds the note as a query and returns the nearest names, closest first', async () => {
    const { supabase, rpc } = db({
      data: [
        { id: 'a', name: 'Walkability and proximity benefits', similarity: 0.82 },
        { id: 'b', name: 'Urban design and travel patterns', similarity: 0.8 },
      ],
      error: null,
    });
    const names = await loadNearestThemeNames(supabase, NOTE, { userId: 'u1', embed: embedded });

    expect(names).toEqual(['Walkability and proximity benefits', 'Urban design and travel patterns']);
    expect(embedded).toHaveBeenCalledWith(
      expect.objectContaining({ texts: [noteEmbeddingText(NOTE)], inputType: 'query' }),
    );
    expect(rpc).toHaveBeenCalledWith('nearest_themes', {
      query_embedding: `[${vector.join(',')}]`,
      p_user_id: 'u1',
      match_limit: NEAREST_THEMES_OFFERED,
      embedding_model_filter: 'voyage-4-lite',
    });
  });

  it('returns no names, without asking the database, when there is no embedding key', async () => {
    const { supabase, rpc } = db({ data: [], error: null });
    const names = await loadNearestThemeNames(supabase, NOTE, {
      embed: async () => ({ ok: false, reason: 'no-key', detail: 'unset', tokens: 0 }),
    });
    expect(names).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns no names when the embedding call throws or the lookup fails', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrown = await loadNearestThemeNames(db({ data: [], error: null }).supabase, NOTE, {
      embed: async () => {
        throw new Error('socket hang up');
      },
    });
    const failed = await loadNearestThemeNames(
      db({ data: null, error: { message: 'function does not exist' } }).supabase,
      NOTE,
      { embed: embedded },
    );
    quiet.mockRestore();

    expect(thrown).toEqual([]);
    expect(failed).toEqual([]);
  });
});
