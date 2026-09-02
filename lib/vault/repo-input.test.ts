import { describe, expect, it } from 'vitest';
import { parseRepoInput } from '@/lib/vault/repo-input';

/**
 * People paste whatever their browser or Obsidian gave them. Accepting all of
 * it costs three regexes and removes the most likely reason a first connection
 * fails.
 */
describe('parseRepoInput', () => {
  it('accepts owner/repo', () => {
    expect(parseRepoInput('knightx4/my-vault')).toEqual({ owner: 'knightx4', repo: 'my-vault' });
  });

  it('accepts a browser URL', () => {
    expect(parseRepoInput('https://github.com/knightx4/my-vault')).toEqual({
      owner: 'knightx4',
      repo: 'my-vault',
    });
  });

  it('accepts a clone URL, with or without .git', () => {
    expect(parseRepoInput('https://github.com/knightx4/my-vault.git')).toEqual({
      owner: 'knightx4',
      repo: 'my-vault',
    });
    expect(parseRepoInput('git@github.com:knightx4/my-vault.git')).toEqual({
      owner: 'knightx4',
      repo: 'my-vault',
    });
  });

  it('tolerates a trailing slash and surrounding space', () => {
    expect(parseRepoInput('  https://github.com/knightx4/my-vault/  ')).toEqual({
      owner: 'knightx4',
      repo: 'my-vault',
    });
  });

  it('rejects anything that is not a repository', () => {
    expect(parseRepoInput('')).toBeNull();
    expect(parseRepoInput('my-vault')).toBeNull();
    expect(parseRepoInput('https://gitlab.com/knightx4/my-vault')).toBeNull();
    expect(parseRepoInput('https://github.com/knightx4')).toBeNull();
  });
});
