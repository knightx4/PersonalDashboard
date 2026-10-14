import { describe, expect, it } from 'vitest';
import { cleanName, describePlaces, IDEAS_SHOWN, NAME_MAX, readNames, type PlaceToName } from './name';

const place = (key: string, count = 3): PlaceToName => ({
  key,
  ideas: Array.from({ length: count }, (_, i) => ({ name: `Idea ${key}${i}`, claim: `Claim ${key}${i}.` })),
});

describe('describePlaces', () => {
  it('numbers the places, shows at most twelve ideas each and lists the names in use', () => {
    const text = describePlaces([place('a', 20), place('b')], ['Sleep and memory']);
    expect(text).toContain('Place 1:');
    expect(text).toContain('Place 2:');
    expect(text.match(/- Idea a/g)).toHaveLength(IDEAS_SHOWN);
    expect(text).toContain('- Idea b0: Claim b0.');
    expect(text).toContain('- Sleep and memory');
  });
});

describe('cleanName', () => {
  it('trims quotes and a closing full stop', () => {
    expect(cleanName('  "Chip shortages and the bullwhip." ')).toBe('Chip shortages and the bullwhip');
  });

  it(`cuts a long name at a word, within ${NAME_MAX} characters`, () => {
    const name = cleanName('The long and winding history of every pricing model ever tried in software');
    expect(name.length).toBeLessThanOrEqual(NAME_MAX);
    expect(name.endsWith(' ')).toBe(false);
    expect('The long and winding history of every pricing model ever tried in software'.startsWith(name)).toBe(true);
  });
});

describe('readNames', () => {
  const places = [place('p1'), place('p2'), place('p3')];

  it('matches names back to their places by number', () => {
    const result = readNames(
      { names: [{ place: 1, name: 'Pricing power' }, { place: 3, name: 'Sleep and memory' }] },
      places,
      [],
    );
    expect(result).toEqual({
      ok: true,
      names: new Map([
        ['p1', 'Pricing power'],
        ['p3', 'Sleep and memory'],
      ]),
    });
  });

  it('leaves out numbers out of range, empty names, repeats and names already in use', () => {
    const result = readNames(
      {
        names: [
          { place: 0, name: 'Nothing' },
          { place: 4, name: 'Nothing either' },
          { place: 1, name: '  ' },
          { place: 2, name: 'Unit economics' },
          { place: 2, name: 'Second go' },
          { place: 3, name: 'unit economics' },
          { place: 1, name: 'Sleep and memory' },
        ],
      },
      places,
      ['Sleep and Memory'],
    );
    expect(result).toEqual({ ok: true, names: new Map([['p2', 'Unit economics']]) });
  });

  it('refuses a payload of the wrong shape', () => {
    expect(readNames({ picks: [] }, places, [])).toEqual({ ok: false, detail: 'The report did not match its schema.' });
  });
});
