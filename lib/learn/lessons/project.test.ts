import { describe, expect, it } from 'vitest';
import type { HandInRow } from './practice';
import {
  PROJECT_LIMITS,
  planLines,
  projectPrompt,
  toProjectView,
  toWrittenProject,
  type PlanForProject,
  type ProjectPayload,
  type ProjectRow,
} from './project';

/**
 * A plan's final project (plan #1146): written from the whole outline,
 * checked like a piece's practice with larger limits, and shown without its
 * points or worked answer until it is passed.
 */

const plan: PlanForProject = {
  goal: 'Read a SaaS company’s metrics',
  about: 'For interviews in SaaS finance.',
  depth: 'solid',
  units: [
    { ordinal: 2, title: 'CAC and payback', covers: 'Acquisition cost.', outcome: 'Work out CAC payback.' },
    { ordinal: 1, title: 'Retention', covers: 'Cohorts and churn.', outcome: 'Read a cohort grid.' },
  ],
};

const payload: ProjectPayload = {
  title: '  Retention and payback at a listed SaaS company ',
  task: 'From the figures below, work out NRR and CAC payback, and say whether growth is efficient.',
  columns: ['Quarter', 'ARR', 'S&M spend'],
  rows: Array.from({ length: 20 }, (_, index) => [`Q${index + 1}`, '100', '10']),
  figures: [
    { label: 'NRR', unit: '%' },
    { label: 'CAC payback', unit: 'months' },
  ],
  points: ['NRR is 115%.', 'CAC payback is 18 months.', 'Judges growth efficient.', 'Gives the reason.', 'A', 'B', 'C', 'D', 'E'],
  worked: 'NRR = 115%; payback = 18 months; efficient.',
};

describe('projectPrompt', () => {
  it('gives the goal and every unit in order with what it covers', () => {
    const prompt = projectPrompt(plan, 'report_project');
    expect(prompt).toContain('The learning goal: Read a SaaS company’s metrics');
    expect(prompt).toContain('How deep they want to go: solid');
    expect(prompt.indexOf('1. Retention')).toBeLessThan(prompt.indexOf('2. CAC and payback'));
    expect(prompt).toContain('   By the end: Work out CAC payback.');
    expect(prompt.endsWith('Call report_project.')).toBe(true);
  });

  it('gives the marker only the unit titles', () => {
    const lines = planLines(plan, 'titles');
    expect(lines).toContain('1. Retention');
    expect(lines.join('\n')).not.toContain('Covers:');
  });
});

describe('toWrittenProject', () => {
  it('keeps the title and trims to the project limits', () => {
    const checked = toWrittenProject(payload);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.project.title).toBe('Retention and payback at a listed SaaS company');
    expect(checked.project.points).toHaveLength(PROJECT_LIMITS.points);
    expect(checked.project.data?.rows).toHaveLength(PROJECT_LIMITS.rows);
    expect(checked.project.figures.map((figure) => figure.label)).toEqual(['NRR', 'CAC payback']);
  });

  it('refuses a project with no title, and one with no points', () => {
    expect(toWrittenProject({ ...payload, title: ' ' }).ok).toBe(false);
    expect(toWrittenProject({ ...payload, points: [] }).ok).toBe(false);
  });
});

describe('toProjectView', () => {
  const row: ProjectRow = {
    id: 'p1',
    title: 'Retention and payback',
    task: 'Work it out.',
    data: null,
    figures: [{ label: 'NRR', unit: '%' }],
    points: ['NRR is 115%.'],
    worked: 'NRR = 115%.',
    spreadsheet_note: null,
  };
  const handIn: HandInRow = {
    id: 'h1',
    answer: 'Divided.',
    figures: [{ label: 'NRR', value: '110%' }],
    marks: [{ point: 'NRR is 115%.', met: false, note: 'Check the churned revenue.' }],
    passed: false,
    created_at: '2026-09-27T10:00:00Z',
  };

  it('keeps the points and worked answer on the server until it is passed', () => {
    const view = toProjectView(row, handIn, false);
    expect(view.worked).toBeNull();
    expect(JSON.stringify(view)).not.toContain('NRR is 115%');
    expect(view.latest?.marks).toEqual([{ met: false, note: 'Check the churned revenue.' }]);
  });

  it('shows the worked answer once passed', () => {
    expect(toProjectView(row, null, true).worked).toBe('NRR = 115%.');
  });
});
