import { describe, expect, it } from 'vitest';
import { pageView, routePattern, type PageRequest } from './page-view';

function request(pathname: string, headers: Record<string, string> = {}, method = 'GET'): PageRequest {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { method, pathname, headers: { get: (name) => lower.get(name.toLowerCase()) ?? null } };
}

const DOCUMENT = { 'sec-fetch-dest': 'document', accept: 'text/html' };
const NAVIGATION = { rsc: '1', 'sec-fetch-dest': 'empty' };

describe('routePattern', () => {
  it('replaces ids with the segment they fill', () => {
    expect(routePattern('/learn/s/6f1c1f5e-0000-4000-8000-0000000000d0')).toBe('/learn/s/[id]');
    expect(routePattern('/learn/s/abc/p/3')).toBe('/learn/s/[id]/p/[piece]');
    expect(routePattern('/timeline/year/2026')).toBe('/timeline/year/[year]');
  });

  it('prefers a static segment over a dynamic one', () => {
    expect(routePattern('/goals/files')).toBe('/goals/files');
    expect(routePattern('/goals/some-goal-id')).toBe('/goals/[goalId]');
  });

  it('takes route groups out and matches a catch-all of any depth', () => {
    expect(routePattern('/jobs/roles/42')).toBe('/jobs/roles/[id]');
    expect(routePattern('/vault/n/notes/2026/idea.md')).toBe('/vault/n/[...path]');
  });

  it('keeps the root and a trailing slash', () => {
    expect(routePattern('/')).toBe('/');
    expect(routePattern('/learn/')).toBe('/learn');
  });

  it('is null for what is not a page', () => {
    expect(routePattern('/api/cron/daily')).toBeNull();
    expect(routePattern('/robots.txt')).toBeNull();
    expect(routePattern('/no/such/page/here')).toBeNull();
  });
});

describe('pageView', () => {
  it('records a document request and a client navigation, with route and workspace', () => {
    expect(pageView(request('/learn/s/abc', DOCUMENT))).toEqual({
      route: '/learn/s/[id]',
      workspace: 'learn',
      via: 'load',
    });
    expect(pageView(request('/goals/g1', NAVIGATION))).toEqual({
      route: '/goals/[goalId]',
      workspace: 'goals',
      via: 'navigation',
    });
    expect(pageView(request('/timeline', DOCUMENT))).toEqual({ route: '/timeline', workspace: null, via: 'load' });
  });

  it('skips prefetches', () => {
    expect(pageView(request('/learn', { ...NAVIGATION, 'next-router-prefetch': '1' }))).toBeNull();
    expect(pageView(request('/learn', { ...NAVIGATION, 'next-router-segment-prefetch': '/_tree' }))).toBeNull();
    expect(pageView(request('/learn', { ...DOCUMENT, 'sec-purpose': 'prefetch' }))).toBeNull();
  });

  it('skips server action posts, /api routes and static files', () => {
    expect(pageView(request('/learn', { ...NAVIGATION, 'next-action': 'abc' }, 'POST'))).toBeNull();
    expect(pageView(request('/api/ask', DOCUMENT))).toBeNull();
    expect(pageView(request('/robots.txt', DOCUMENT))).toBeNull();
    expect(pageView(request('/learn', { 'sec-fetch-dest': 'image' }))).toBeNull();
  });
});
