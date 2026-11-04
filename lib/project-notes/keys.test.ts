import { describe, expect, it } from 'vitest';
import { allowedOrigin, bearerToken, keyHash, noteKeyTable, projectNotesUrl } from './keys';

describe('project app keys', () => {
  it('knows which projects take notes', () => {
    expect(noteKeyTable('music-pipeline')).toBe('studio_keys');
    expect(noteKeyTable('sckwebsite')).toBeNull();
    expect(noteKeyTable('constructor')).toBeNull();
  });

  it('hashes a token as studio_mint_key stores it', () => {
    expect(keyHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('reads a bearer token and nothing else', () => {
    const tok = 'a'.repeat(64);
    expect(bearerToken(`Bearer ${tok}`)).toBe(tok);
    expect(bearerToken(`Basic ${tok}`)).toBeNull();
    expect(bearerToken('Bearer short')).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it('makes the endpoint and allows only the project site or localhost', () => {
    expect(projectNotesUrl('https://dash.example/', 'music-pipeline')).toBe(
      'https://dash.example/api/projects/music-pipeline/notes',
    );
    const site = 'https://map-studio-liard.vercel.app';
    expect(allowedOrigin(site, `${site}/app`)).toBe(site);
    expect(allowedOrigin('https://evil.example', site)).toBeNull();
    expect(allowedOrigin('http://localhost:5173', null)).toBe('http://localhost:5173');
    expect(allowedOrigin(null, site)).toBeNull();
  });
});
