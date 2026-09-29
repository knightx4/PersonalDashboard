import { describe, expect, it } from 'vitest';
import { rankHits } from '@/lib/search/rank';
import { devHits, firstLine, matchVisions, matchWaiting, planHref } from './dev-map';

describe('dev search hits', () => {
  it('lands a step on the plan with its number in the search box', () => {
    expect(planHref(612)).toBe('/dev/plan?view=all&q=%23612');
    const [hit] = devHits({
      plan: [{ id: 'p', number: 612, title: 'Search', parent_id: 'f', status: 'not_started' }],
      ideas: [],
      notes: [],
      specs: [],
    });
    expect(hit).toMatchObject({
      module: 'dev',
      kind: 'plan',
      subtitle: 'Step #612 · not started',
      match: '#612',
    });
  });

  it('calls a step with no parent a feature', () => {
    const [hit] = devHits({
      plan: [{ id: 'p', number: 1, title: 'Plan', parent_id: null, status: 'done' }],
      ideas: [],
      notes: [],
      specs: [],
    });
    expect(hit.subtitle).toBe('Feature #1 · done');
  });

  it('sends specs to their page and ideas and notes to their row', () => {
    const hits = devHits({
      plan: [],
      specs: [{ slug: 'writing', title: 'Writing guide', blurb: 'How to write' }],
      ideas: [{ id: 'i1', body: 'An idea\nmore', module: null }],
      notes: [{ id: 'n1', body: 'It broke', kind: 'bug', status: 'in_progress' }],
    });
    expect(hits.map((hit) => hit.href)).toEqual([
      '/dev/specs/writing',
      '/dev/ideas#idea-i1',
      '/dev/bugs#note-n1',
    ]);
    expect(hits[1].title).toBe('An idea');
    expect(hits[2].subtitle).toBe('Bug · in progress');
  });

  it('calls a like a like', () => {
    const [hit] = devHits({
      plan: [],
      specs: [],
      ideas: [],
      notes: [{ id: 'n2', body: 'The plan page', kind: 'like', status: 'open' }],
    });
    expect(hit.subtitle).toBe('Like · open');
  });

  it('shortens a long first line', () => {
    expect(firstLine('a'.repeat(200), 10)).toBe(`${'a'.repeat(9)}…`);
    expect(firstLine('   ')).toBe('Untitled');
  });

  it('sends an open question and a raise to their card on the Dash tab', () => {
    const hits = devHits({
      plan: [],
      specs: [],
      ideas: [],
      notes: [],
      questions: [{ id: 'q1', number: 900, title: 'Which shape?', detail: 'A — CSV.\nB — JSON.' }],
      raises: [{ id: 'r1', title: 'Token expired', detail: 'It ran out.', ask: 'Renew it?', status: 'open' }],
    });
    expect(hits.map((hit) => [hit.kind, hit.href])).toEqual([
      ['plan', '/dev/raised#waiting-q1'],
      ['raise', '/dev/raised#raise-r1'],
    ]);
    expect(hits[0].subtitle).toBe('Question #900 · waiting on you');
    expect(hits[0].match).toContain('JSON');
    expect(hits[1].subtitle).toBe('Raised · open');
    expect(hits[1].match).toContain('Renew it?');
  });

  it('finds a question by a word in its options and a raise by a word in its ask', () => {
    const rows = {
      questions: [
        { id: 'q1', number: 900, title: 'Which shape?', detail: 'A — CSV.\nB — JSON.' },
        { id: 'q2', number: 901, title: 'Which colour?', detail: null },
      ],
      raises: [
        { id: 'r1', title: 'Token expired', detail: null, ask: 'Renew the GitHub token?', status: 'open' },
        { id: 'r2', title: 'Slow page', detail: 'The plan page', ask: null, status: 'answered' },
      ],
    };
    const found = matchWaiting(rows, 'json', 10);
    expect(found.questions.map((row) => row.id)).toEqual(['q1']);
    expect(found.raises).toEqual([]);

    expect(matchWaiting(rows, 'GITHUB', 10).raises.map((row) => row.id)).toEqual(['r1']);
    expect(matchWaiting(rows, '#901', 10).questions.map((row) => row.id)).toEqual(['q2']);
    expect(matchWaiting(rows, undefined, 1)).toEqual({
      questions: [rows.questions[0]],
      raises: [rows.raises[0]],
    });
  });

  it('finds a vision by a word only in its text and opens the specs page at it', () => {
    const visions = [
      { module: 'jobs', body: 'A calm place to track the search.' },
      { module: 'app', body: 'One dashboard for a whole life.' },
      { module: 'news', body: '   ' },
    ];
    expect(matchVisions(visions, 'CALM', 10).map((row) => row.module)).toEqual(['jobs']);
    expect(matchVisions(visions, undefined, 10).map((row) => row.module)).toEqual(['jobs', 'app']);

    const hits = devHits({ plan: [], specs: [], ideas: [], notes: [], visions: visions.slice(0, 2) });
    expect(hits.map((hit) => [hit.kind, hit.title, hit.href])).toEqual([
      ['vision', 'Vision for Job search', '/dev/specs#vision-jobs'],
      ['vision', 'Vision for the app', '/dev/specs#vision-app'],
    ]);
    expect(rankHits(hits, 'calm').map((hit) => hit.id)).toEqual(['jobs']);
  });
});
