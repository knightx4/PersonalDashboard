import { describe, expect, it } from 'vitest';
import {
  ROLE_TABS,
  defaultRoleTab,
  roleTabFrom,
  roleTabSearch,
} from '@/app/jobs/(app)/roles/[id]/tabs';

describe('the role page tab in the address', () => {
  it('reads every tab from its own ?tab= value', () => {
    for (const tab of ROLE_TABS) expect(roleTabFrom(tab)).toBe(tab);
  });

  it('keeps the old ids that links were written with', () => {
    expect(roleTabFrom('answers')).toBe('answers');
    expect(roleTabFrom('notes')).toBe('notes');
  });

  it('names no tab for a value that is not one, or none', () => {
    expect(roleTabFrom('comments')).toBeUndefined();
    expect(roleTabFrom(null)).toBeUndefined();
    expect(roleTabFrom(undefined)).toBeUndefined();
  });

  it('opens on the timeline until a stage says otherwise', () => {
    expect(defaultRoleTab('submitted')).toBe('timeline');
  });

  it('writes the tab and keeps the other parameters', () => {
    expect(roleTabSearch('', 'posting')).toBe('?tab=posting');
    expect(roleTabSearch('tab=timeline&from=board', 'mail')).toBe('?tab=mail&from=board');
  });

  it('drops the interview to scroll to once you leave the Interviews tab', () => {
    expect(roleTabSearch('tab=interviews&interview=i1', 'posting')).toBe('?tab=posting');
    expect(roleTabSearch('interview=i1', 'interviews')).toBe('?interview=i1&tab=interviews');
  });
});
