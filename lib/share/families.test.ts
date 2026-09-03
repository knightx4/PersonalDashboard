import { describe, expect, it } from 'vitest';
import { suggestFamilies, type FamilyCandidate } from './families';

function shelf(...names: string[]): FamilyCandidate[] {
  return names.map((name, index) => ({
    inventoryItemId: `id-${index}`,
    name,
    shortName: null,
  }));
}

function membersOf(suggestions: ReturnType<typeof suggestFamilies>, slug: string) {
  const family = suggestions.find((f) => f.slug === slug);
  if (!family) throw new Error(`no family ${slug}`);
  return family;
}

describe('suggestFamilies', () => {
  it('builds a family from a colon and pulls the bare base game into it', () => {
    const items = shelf('Catan', 'Catan: Seafarers', 'Catan: Cities & Knights');
    const family = membersOf(suggestFamilies(items), 'catan');

    expect(family.name).toBe('Catan');
    expect(family.members).toHaveLength(3);
    expect(family.members[0]?.role).toBe('base');
  });

  it('lands a suffix-only title under the family a colon established', () => {
    // "Monopoly Junior" has no colon, so it only groups because "Monopoly:
    // Star Wars" created the family first.
    const items = shelf('Monopoly: Star Wars Edition', 'Monopoly Junior', 'Monopoly');
    const family = membersOf(suggestFamilies(items), 'monopoly');
    expect(family.members).toHaveLength(3);
  });

  it('reads the role off the box', () => {
    const items = shelf(
      'Carcassonne',
      'Carcassonne: Inns & Cathedrals Expansion',
      'Carcassonne: Big Box Edition',
      'Carcassonne: Card Sleeves',
    );
    const roles = new Map(
      membersOf(suggestFamilies(items), 'carcassonne').members.map((m) => [
        m.inventoryItemId,
        m.role,
      ]),
    );
    expect(roles.get('id-0')).toBe('base');
    expect(roles.get('id-1')).toBe('expansion');
    expect(roles.get('id-2')).toBe('edition');
    expect(roles.get('id-3')).toBe('accessory');
  });

  it('strips an "Expansion 2" tail out of the family name', () => {
    const items = shelf(
      'Agricola',
      'Agricola Expansion 2: Farmers of the Moor',
      'Agricola: Belgium Deck',
    );
    const suggestions = suggestFamilies(items);
    expect(suggestions.map((f) => f.slug)).toEqual(['agricola']);
    expect(membersOf(suggestions, 'agricola').members).toHaveLength(3);
  });

  it('refuses to invent a family from a shared first word', () => {
    // The rule this test exists for: a bare first-word match would put these
    // two together, and being confidently wrong costs more than the grouping
    // is worth.
    expect(suggestFamilies(shelf('The Game of Life', 'The Game of Thrones'))).toEqual([]);
  });

  it('does not let a family swallow a word that merely starts the same', () => {
    const items = shelf('Catan', 'Catan: Seafarers', 'Catanzaro Nights');
    const family = membersOf(suggestFamilies(items), 'catan');
    expect(family.members.map((m) => m.inventoryItemId)).not.toContain('id-2');
  });

  it('re-homes a title whose own family had nobody else in it', () => {
    // "Ticket to Ride Europe: 1912" names a family of one. Dropping it as a
    // singleton would strand the item with no grouping at all while a broader
    // "Ticket to Ride" sits right there.
    const items = shelf(
      'Ticket to Ride',
      'Ticket to Ride: Europe',
      'Ticket to Ride Europe: 1912',
    );
    const suggestions = suggestFamilies(items);
    expect(suggestions.map((f) => f.slug)).toEqual(['ticket-to-ride']);
    expect(
      membersOf(suggestions, 'ticket-to-ride').members.map((m) => m.inventoryItemId).sort(),
    ).toEqual(['id-0', 'id-1', 'id-2']);
  });

  it('proposes nothing for a shelf of unrelated games', () => {
    expect(suggestFamilies(shelf('Wingspan', 'Azul', 'Root'))).toEqual([]);
  });

  it('never proposes a family of one', () => {
    expect(suggestFamilies(shelf('Gloomhaven: Jaws of the Lion'))).toEqual([]);
  });

  it('sees through retail packaging noise before clustering', () => {
    const items = shelf(
      'Hasbro Gaming Monopoly Board Game, Ages 8+',
      'Monopoly: Star Wars Edition',
    );
    expect(membersOf(suggestFamilies(items), 'monopoly').members).toHaveLength(2);
  });
});
