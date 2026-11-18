import { describe, expect, it } from 'vitest';
import type { DevProject } from './projects';
import { fileStep, flagComment, namedRepositories } from './step-project';

/** Which project a new step is filed under (plan #3095). */

const project = (id: string, repo: string, extra: Partial<DevProject> = {}): DevProject => ({
  id,
  label: id,
  description: '',
  repo: { owner: 'example-owner', repo, branch: 'main' },
  url: null,
  skill: '.claude/skills/plan/SKILL.md',
  checkCommand: null,
  setUpAt: null,
  archivedAt: null,
  ...extra,
});

const MUSIC = project('music-pipeline', 'music-pipeline', { botId: 'bot-maemae' });
const SITE = project('website', 'example-site');
const OLD = project('old-thing', 'old-thing', { archivedAt: '2026-10-01T00:00:00Z' });
const PROJECTS = [MUSIC, SITE, OLD];
const APP = { owner: 'example-owner', repo: 'dashboard' };

const file = (detail: string, extra: Partial<Parameters<typeof fileStep>[0]> = {}) =>
  fileStep({ title: 'A step', detail, projects: PROJECTS, appRepo: APP, ...extra });

describe('fileStep', () => {
  it('files a step whose detail says "Repository: owner/name" under that project', () => {
    expect(file('Repository: example-owner/music-pipeline, live at the studio.')).toEqual({
      scope: 'music-pipeline',
      why: 'repo',
      flag: null,
    });
    expect(file('Repo: https://github.com/example-owner/music-pipeline.')).toMatchObject({ scope: 'music-pipeline' });
  });

  it('leaves a step that names no repository under the app as a whole, or its workspace', () => {
    expect(file('Move the panel to Home.')).toEqual({ scope: null, why: 'default', flag: null });
    expect(file('Move the panel to Home.', { fallback: 'dev' })).toEqual({ scope: 'dev', why: 'default', flag: null });
  });

  it('takes the parent scope first, whatever the detail names', () => {
    expect(file('Repository: example-owner/music-pipeline', { parentScope: 'jobs' })).toMatchObject({
      scope: 'jobs',
      why: 'parent',
    });
    expect(file('', { parentScope: 'music-pipeline' })).toMatchObject({ scope: 'music-pipeline' });
  });

  it('takes a project named outright, but only an active one', () => {
    expect(file('', { project: 'website' })).toMatchObject({ scope: 'website', why: 'asked' });
    expect(file('', { project: 'old-thing' })).toMatchObject({ scope: null });
  });

  it('counts an unlabelled link or owner/name only when it is the one repository named', () => {
    expect(file('Mirror what github.com/example-owner/example-site does.')).toMatchObject({ scope: 'website' });
    expect(file('Ported from example-owner/music-pipeline.')).toMatchObject({ scope: 'music-pipeline' });
    expect(file('Compare example-owner/music-pipeline with example-owner/example-site.')).toMatchObject({ scope: null });
    expect(file('Port example-owner/music-pipeline into example-owner/dashboard.')).toMatchObject({ scope: null });
  });

  it('keeps a step that names this app as its repository in the app', () => {
    expect(file('Repository: example-owner/dashboard. Mentions example-owner/music-pipeline.')).toEqual({
      scope: null,
      why: 'default',
      flag: null,
    });
  });

  it('files a step a tied bot asks for or passes on under its project', () => {
    expect(file('Make the clip editor resize.', { botIds: ['bot-bob', 'bot-maemae'] })).toMatchObject({
      scope: 'music-pipeline',
      why: 'bot',
    });
    expect(file('Make the clip editor resize.', { botIds: ['bot-bob'] })).toMatchObject({ scope: null });
  });

  it('prefers the repository named over the bot', () => {
    expect(file('Repository: example-owner/example-site', { botIds: ['bot-maemae'] })).toMatchObject({ scope: 'website' });
  });

  it('flags a named repository that is not a project and files it where it would have gone', () => {
    const filed = file('Repository: example-owner/recipes. Fix the import.', { botIds: ['bot-maemae'] });
    expect(filed.scope).toBeNull();
    expect(filed.flag).toContain('example-owner/recipes');
    expect(filed.flag).toContain('the app as a whole');
    expect(file('See https://github.com/someone/else for the idea.', { fallback: 'jobs' }).flag).toContain(
      'the jobs workspace',
    );
    expect(file('Repository: example-owner/old-thing').flag).toContain('example-owner/old-thing');
  });

  it('does not take paths or "and/or" for repositories', () => {
    expect(namedRepositories('Change lib/plan/tree.ts and app/dev/plan, and/or the page.', PROJECTS)).toEqual({
      labelled: [],
      mentioned: [],
    });
    expect(file('Change lib/plan/tree.ts and/or app/dev/plan.')).toEqual({ scope: null, why: 'default', flag: null });
  });
});

describe('flagComment', () => {
  const at = new Date('2026-11-12T10:00:00Z');
  it('writes nothing new without a flag, and a dated line after any history with one', () => {
    expect(flagComment(null, 'earlier', at)).toBe('earlier');
    expect(flagComment('Names x.', null, at)).toBe('Flagged 2026-11-12: Names x.');
    expect(flagComment('Names x.', 'earlier', at)).toBe('earlier\n\nFlagged 2026-11-12: Names x.');
  });
});
