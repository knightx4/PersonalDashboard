import { describe, expect, it } from 'vitest';
import { repositoryFromRemote } from './remote';
import { refusalFor } from './github';

describe('repositoryFromRemote', () => {
  it('reads https, ssh and proxied remotes', () => {
    expect(repositoryFromRemote('https://github.com/acme/app.git\n')).toBe('acme/app');
    expect(repositoryFromRemote('https://github.com/acme/app')).toBe('acme/app');
    expect(repositoryFromRemote('git@github.com:acme/app.git')).toBe('acme/app');
    expect(repositoryFromRemote('http://proxy@127.0.0.1:4321/git/acme/app')).toBe('acme/app');
  });

  it('names nothing for a remote with no repository in it', () => {
    expect(repositoryFromRemote('')).toBeNull();
    expect(repositoryFromRemote('not a url')).toBeNull();
  });
});

describe('refusalFor a repository with no name', () => {
  it('says the repository is unnamed rather than blaming the token', () => {
    const said = refusalFor(404, '/repos//compare/main...abc');
    expect(said).toContain('no name');
    expect(said).not.toContain('GITHUB_READ_TOKEN');
  });
});
