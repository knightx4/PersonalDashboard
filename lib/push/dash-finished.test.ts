import { describe, expect, it } from 'vitest';
import { BODY_MAX, TITLE_MAX } from '@/lib/day-brief/notification';
import { dashFinishedPayload } from './dash-finished';

describe('dashFinishedPayload', () => {
  it('names one thing and the inbox count', () => {
    const p = dashFinishedPayload({ finished: 1, failed: 0, inbox: 5 });
    expect(p.title).toBe('Dash finished 1 thing.');
    expect(p.body).toBe('5 in your inbox.');
  });

  it('counts several things', () => {
    const p = dashFinishedPayload({ finished: 3, failed: 0, inbox: 5 });
    expect(`${p.title} ${p.body}`).toBe('Dash finished 3 things. 5 in your inbox.');
  });

  it('says how many failed beside the finished ones', () => {
    expect(dashFinishedPayload({ finished: 2, failed: 1, inbox: 4 }).title).toBe('Dash finished 2 things, 1 failed.');
  });

  it('reports failures alone, singular and plural', () => {
    expect(dashFinishedPayload({ finished: 0, failed: 1, inbox: 1 }).title).toBe('A Dash run failed.');
    expect(dashFinishedPayload({ finished: 0, failed: 2, inbox: 1 }).title).toBe('2 Dash runs failed.');
  });

  it('handles one item and an empty inbox', () => {
    expect(dashFinishedPayload({ finished: 1, failed: 0, inbox: 1 }).body).toBe('1 in your inbox.');
    expect(dashFinishedPayload({ finished: 1, failed: 0, inbox: 0 }).body).toBe('Nothing waiting in your inbox.');
  });

  it('opens the inbox with a fixed tag, within lock-screen limits', () => {
    const a = dashFinishedPayload({ finished: 99999, failed: 99999, inbox: 99999 });
    const b = dashFinishedPayload({ finished: 1, failed: 0, inbox: 0 });
    expect(a.url).toBe('/dev/inbox');
    expect(a.tag).toBe(b.tag);
    expect(a.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(a.body.length).toBeLessThanOrEqual(BODY_MAX);
  });

  it('treats negative counts as zero', () => {
    expect(dashFinishedPayload({ finished: -2, failed: 0, inbox: -1 })).toMatchObject({
      title: 'Dash is idle.',
      body: 'Nothing waiting in your inbox.',
    });
  });
});
