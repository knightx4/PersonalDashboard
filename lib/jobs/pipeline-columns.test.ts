import { describe, expect, it } from 'vitest';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import { COLUMN_COMPANY_LIMIT, pipelineColumnFilters } from './pipeline-columns';
import { filterPipeline, parsePipeline, type PipelineParams } from './pipeline-view';

function row(status: ApplicationStatus, company: string): PipelineRow {
  return {
    status,
    source: 'cold_apply',
    excitement: null,
    scoreNote: null,
    companyName: company,
    companySlug: company.toLowerCase(),
    roleTitle: 'Engineer',
  } as unknown as PipelineRow;
}

const rows = [row('submitted', 'Monzo'), row('submitted', 'Monzo'), row('lead', 'Stripe'), row('rejected', 'Wise')];

function filtersFor(params: PipelineParams, scored = false) {
  const state = parsePipeline(params);
  const { scoped } = filterPipeline(rows, state);
  return pipelineColumnFilters(params, state, scoped, rows, scored);
}

describe('pipelineColumnFilters', () => {
  it('offers a filter on the columns that have one, and none on the rest', () => {
    const filters = filtersFor({ view: 'table' });
    expect(Object.keys(filters).sort()).toEqual(['applied', 'company', 'excitement', 'status']);
    expect(Object.keys(filtersFor({ view: 'table' }, true))).toContain('fit');
  });

  it('lists the companies in scope, most applications first, with links that keep the table', () => {
    const { company } = filtersFor({ view: 'table' });
    expect(company.active).toBe(false);
    expect(company.choices.map((c) => c.label)).toEqual(['Any company', 'Monzo · 2', 'Stripe · 1']);
    expect(company.choices[1].href).toBe('/jobs/pipeline?view=table&company=monzo');
  });

  it('marks the chosen company and narrows the table to it', () => {
    const params = { view: 'table', company: 'monzo' };
    const { company } = filtersFor(params);
    expect(company.active).toBe(true);
    expect(company.choices.find((c) => c.current)?.id).toBe('company-monzo');
    expect(filterPipeline(rows, parsePipeline(params)).filtered).toHaveLength(2);
  });

  it('caps the company list', () => {
    const many = Array.from({ length: COLUMN_COMPANY_LIMIT + 3 }, (_, i) => row('submitted', `Co${i}`));
    const state = parsePipeline({ view: 'table' });
    const { company } = pipelineColumnFilters({ view: 'table' }, state, many, many, false);
    expect(company.choices).toHaveLength(COLUMN_COMPANY_LIMIT + 1);
  });

  it('counts the status choices across live and closed, and takes a stage', () => {
    const { status } = filtersFor({ view: 'table' });
    expect(status.choices.find((c) => c.id === 'closed')?.label).toBe('Closed · 1');
    expect(status.choices.find((c) => c.id === 'stage-submitted')?.label).toBe('Submitted · 2');
    expect(filtersFor({ view: 'table', stage: 'submitted' }).status.active).toBe(true);
  });
});
