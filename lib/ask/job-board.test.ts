import { describe, expect, it } from 'vitest';
import { toolResultText, type AskContext, type AskDb } from './db';
import { JOB_BOARD_LIMIT, type JobBoardResult } from './job-board';
import { executeAskTool, IN_APP_ONLY_TOOLS } from './tools';

/** read_job_board (note b60cc4a6): a company's open roles from its careers page. */

function context(result: JobBoardResult | null, enabledModules: AskContext['enabledModules'] = ['jobs']) {
  const asked: string[] = [];
  const ctx: AskContext = {
    userId: '00000000-0000-4000-8000-00000000000a',
    today: '2026-10-15',
    enabledModules,
    db: (async () => {
      throw new Error('read_job_board reads no table');
    }) as AskDb,
    searchSources: [],
    ...(result
      ? {
          readJobBoard: async (url: string) => {
            asked.push(url);
            return result;
          },
        }
      : {}),
  };
  return { ctx, asked };
}

const role = (n: number) => ({
  title: `Strategic Finance Lead ${n}`,
  location: 'New York',
  url: `https://jobs.ashbyhq.com/tenexlabs/${n}`,
});

describe('read_job_board', () => {
  it('lists the board\'s open roles with their links for the model, and keeps only the count', async () => {
    const { ctx, asked } = context({ ok: true, vendor: 'ashby', token: 'tenexlabs', postings: [role(1), role(2)] });
    const result = await executeAskTool('read_job_board', { url: 'https://www.tenex.co/careers' }, ctx);
    if (!result.ok) throw new Error(result.error);
    expect(asked).toEqual(['https://www.tenex.co/careers']);
    expect(result.rows).toEqual([]);
    expect(result.found).toEqual([role(1), role(2)]);
    expect(result.kept).toEqual({ open_roles: 2, board: 'ashby:tenexlabs' });
    const sent = toolResultText(result);
    expect(sent).toContain('Strategic Finance Lead 2');
    expect(sent).toContain('https://jobs.ashbyhq.com/tenexlabs/1');
  });

  it('caps a long board and says so', async () => {
    const postings = Array.from({ length: JOB_BOARD_LIMIT + 5 }, (_, i) => role(i));
    const { ctx } = context({ ok: true, vendor: 'ashby', token: 'big', postings });
    const result = await executeAskTool('read_job_board', { url: 'https://big.example.com' }, ctx);
    if (!result.ok) throw new Error(result.error);
    expect(result.found).toHaveLength(JOB_BOARD_LIMIT);
    expect(result.note).toContain(`has ${JOB_BOARD_LIMIT + 5} open roles`);
  });

  it('says when the page links to no board it reads, or could not be read', async () => {
    const none = await executeAskTool('read_job_board', { url: 'https://x.example.com' }, context({ ok: false, reason: 'not_found' }).ctx);
    expect(none).toEqual({ ok: false, error: expect.stringContaining('No job board was found') });
    const down = await executeAskTool('read_job_board', { url: 'https://x.example.com' }, context({ ok: false, reason: 'unreachable' }).ctx);
    expect(down).toEqual({ ok: false, error: expect.stringContaining('could not be read') });
  });

  it('needs a url, the Jobs workspace, and a context that can read boards', async () => {
    const { ctx } = context({ ok: true, vendor: 'ashby', token: 't', postings: [] });
    expect(await executeAskTool('read_job_board', {}, ctx)).toEqual({ ok: false, error: expect.stringContaining('url') });
    const off = context({ ok: true, vendor: 'ashby', token: 't', postings: [] }, []).ctx;
    expect(await executeAskTool('read_job_board', { url: 'https://a.example.com' }, off)).toEqual({
      ok: false,
      error: expect.stringContaining('switched off'),
    });
    expect(await executeAskTool('read_job_board', { url: 'https://a.example.com' }, context(null).ctx)).toEqual({
      ok: false,
      error: 'Job boards cannot be read from here.',
    });
    expect(IN_APP_ONLY_TOOLS).toContain('read_job_board');
  });
});
