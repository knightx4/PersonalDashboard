import { describe, expect, it, vi } from 'vitest';
import { areaChips, joinNames, listOpenAreas, uncoveredAreas } from '@/lib/you/insight-areas';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

const card = (areaId: string | null, areaName: string | null = areaId ? areaId.toUpperCase() : null) => ({
  areaId,
  areaName,
});

describe('areaChips', () => {
  it('counts the waiting cards per area and leaves untagged cards to All', () => {
    const waiting = [card('career'), card('health'), card('career'), card(null)];
    const all = [...waiting, card('home'), card('home'), card('home')];
    expect(areaChips(all, waiting)).toEqual([
      { id: 'home', name: 'HOME', count: 0 },
      { id: 'career', name: 'CAREER', count: 2 },
      { id: 'health', name: 'HEALTH', count: 1 },
    ]);
  });

  it('leaves out a card whose area is gone', () => {
    expect(areaChips([card('gone', null)], [card('gone', null)])).toEqual([]);
  });
});

describe('uncoveredAreas', () => {
  it('names the open areas no insight is about, in their own order', () => {
    const areas = [
      { id: 'career', name: 'Career' },
      { id: 'health', name: 'Health' },
      { id: 'home', name: 'Home' },
    ];
    expect(uncoveredAreas(areas, [card('career'), card(null)])).toEqual(areas.slice(1));
  });
});

describe('joinNames', () => {
  it('joins with commas and a last and', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Health'])).toBe('Health');
    expect(joinNames(['Health', 'Money'])).toBe('Health and Money');
    expect(joinNames(['Health', 'Money', 'Home'])).toBe('Health, Money and Home');
  });
});

describe('listOpenAreas', () => {
  it("reads the person's own open areas in position order", async () => {
    const calls: unknown[][] = [];
    const chain = {
      select: (...a: unknown[]) => (calls.push(['select', ...a]), chain),
      eq: (...a: unknown[]) => (calls.push(['eq', ...a]), chain),
      is: (...a: unknown[]) => (calls.push(['is', ...a]), chain),
      order: (...a: unknown[]) => (
        calls.push(['order', ...a]), Promise.resolve({ data: [{ id: 'a1', name: 'Health' }], error: null })
      ),
    };
    const schema = vi.fn(() => ({ from: () => chain }));
    const client = { schema } as unknown as YouSupabaseClient;
    expect(await listOpenAreas(client, 'u1')).toEqual([{ id: 'a1', name: 'Health' }]);
    expect(schema).toHaveBeenCalledWith('goals');
    expect(calls).toContainEqual(['eq', 'user_id', 'u1']);
    expect(calls).toContainEqual(['is', 'archived_at', null]);
  });
});
