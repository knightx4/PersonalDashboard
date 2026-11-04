import { describe, expect, it } from 'vitest';
import {
  avatarFor,
  avatarSymbolId,
  defaultAvatar,
  parseAvatar,
  sameAvatar,
  SEEDED_AVATARS,
  shuffledAvatar,
  stepTrait,
  traitPosition,
  withTrait,
} from './advisor-avatar';
import { avatarLook, avatarSprite, avatarSvg, spriteFor } from './advisor-avatar-draw';

describe('advisor avatars', () => {
  it('seeds a look for the five seats and every guest the board started with', () => {
    for (const key of [
      'hiring_manager',
      'mentor',
      'skeptic',
      'cfo',
      'dreamer',
      'buffett',
      'franklin',
      'jobs',
      'da_vinci',
      'washington',
      'dalio',
      'dimon',
    ]) {
      expect(SEEDED_AVATARS[key], key).toBeDefined();
    }
  });

  it('gives a key with nothing stored its seeded look, or one drawn from the key', () => {
    expect(avatarFor('buffett', null)).toBe(SEEDED_AVATARS.buffett);
    expect(avatarFor('ada_lovelace', null)).toEqual(defaultAvatar('ada_lovelace'));
    expect(defaultAvatar('ada_lovelace').seed).toBe('ada_lovelace');
  });

  it('draws what each seeded guest is known by', () => {
    expect(avatarLook(SEEDED_AVATARS.buffett)).toMatchObject({
      hair: 'variant42',
      glasses: 'variant03',
      beard: null,
    });
    expect(avatarLook(SEEDED_AVATARS.jobs).glasses).toBe('variant11');
    expect(avatarLook(SEEDED_AVATARS.da_vinci).beard).toBe('variant02');
  });

  it('keeps only the parts and variants Notionists draws from a stored avatar', () => {
    expect(parseAvatar(null)).toBeNull();
    expect(parseAvatar({ seed: '' })).toBeNull();
    expect(parseAvatar({ style: 'pixel-art', seed: 'x' })).toBeNull();
    expect(
      parseAvatar({
        style: 'notionists',
        seed: 'x',
        options: {
          hair: ['variant99'],
          glasses: ['variant03'],
          glassesProbability: 140,
          mouth: ['smile'],
        },
      }),
    ).toEqual({
      style: 'notionists',
      seed: 'x',
      options: { glasses: ['variant03'], glassesProbability: 100 },
    });
  });

  it('sets one trait at a time, with none for glasses and a beard but not hair', () => {
    const base = SEEDED_AVATARS.buffett;
    expect(withTrait(base, 'glasses', null).options).toMatchObject({ glassesProbability: 0 });
    expect(withTrait(base, 'glasses', null).options.glasses).toBeUndefined();
    expect(withTrait(base, 'beard', 'variant02').options).toMatchObject({
      beard: ['variant02'],
      beardProbability: 100,
    });
    expect(withTrait(base, 'hair', null)).toBe(base);
    expect(withTrait(base, 'hair', 'variant99')).toBe(base);
  });

  it('steps through a trait and goes round, passing through none where a trait has it', () => {
    expect(stepTrait('glasses', null, 1)).toBe('variant01');
    expect(stepTrait('glasses', 'variant01', -1)).toBeNull();
    expect(stepTrait('glasses', 'variant11', 1)).toBeNull();
    expect(stepTrait('hair', 'variant01', -1)).toBe('hat');
    expect(traitPosition('glasses', null)).toBe('None');
    expect(traitPosition('hair', 'variant12')).toBe('12 of 64');
  });

  it('shuffles to a fresh seed and tells two looks apart', () => {
    const a = shuffledAvatar(() => 0.25);
    expect(a.seed).not.toBe('');
    expect(sameAvatar(a, { ...a, options: { ...a.options } })).toBe(true);
    expect(sameAvatar(a, withTrait(a, 'hair', 'variant03'))).toBe(false);
  });

  it('draws each advisor once into a sprite, with ids no two drawings share', () => {
    const sprite = avatarSprite([{ key: 'buffett' }, { key: 'jobs' }, { key: 'buffett' }]);
    expect(sprite.match(/<symbol /g)).toHaveLength(2);
    expect(sprite).toContain(`id="${avatarSymbolId('buffett')}"`);
    expect(sprite).not.toContain('<metadata');
    const ids = [...sprite.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('always includes the five seats, so an older meeting draws them', () => {
    const { keys } = spriteFor([{ key: 'buffett' }]);
    expect(keys).toEqual(
      expect.arrayContaining(['buffett', 'hiring_manager', 'mentor', 'skeptic', 'cfo', 'dreamer']),
    );
  });

  it('draws a standalone svg cropped to head and shoulders', () => {
    const svg = avatarSvg(SEEDED_AVATARS.franklin, 'p');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="222 70 1300 1300"');
  });
});
