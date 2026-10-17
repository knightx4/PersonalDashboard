import { describe, expect, it } from 'vitest';
import { researchBrief, researchFromRow, safeUrl, sourcesByKind } from './research';

describe('company research rows', () => {
  it('keeps only sources with a web link, once each, and files an unknown kind under other', () => {
    const research = researchFromRow({
      id: 'r1',
      status: 'ready',
      sources: [
        { url: 'https://acme.com/about', title: 'About', kind: 'company' },
        { url: 'https://acme.com/about', title: 'About again', kind: 'company' },
        { url: 'javascript:alert(1)', title: 'Bad', kind: 'news' },
        { url: 'https://news.example/acme', title: '', kind: 'gossip' },
      ],
    });
    expect(research.sources.map((source) => source.url)).toEqual([
      'https://acme.com/about',
      'https://news.example/acme',
    ]);
    expect(research.sources[1].kind).toBe('other');
    expect(research.sources[1].title).toBe('news.example');
  });

  it('drops sections without a title or body, and drafts for questions that do not exist', () => {
    const research = researchFromRow({
      id: 'r1',
      status: 'ready',
      sections: [{ key: 'business', title: 'Business', body: 'Sells payroll.' }, { title: 'Empty', body: ' ' }],
      drafts: { whyMe: 'Revenue audits.', favouriteColour: 'blue' },
    });
    expect(research.sections).toHaveLength(1);
    expect(research.drafts).toEqual({ whyMe: 'Revenue audits.' });
  });

  it('reads a status it does not know as failed', () => {
    expect(researchFromRow({ id: 'r1', status: 'thinking' }).status).toBe('failed');
  });

  it('groups sources in the tab order, leaving out empty kinds', () => {
    const research = researchFromRow({
      id: 'r1',
      status: 'ready',
      sources: [
        { url: 'https://a.example', title: 'A', kind: 'news' },
        { url: 'https://b.example', title: 'B', kind: 'company' },
      ],
    });
    expect(sourcesByKind(research.sources).map((group) => group.kind)).toEqual(['company', 'news']);
  });

  it('allows only http and https links', () => {
    expect(safeUrl('https://acme.com')).toBe('https://acme.com/');
    expect(safeUrl('mailto:a@b.com')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
  });

  it('names the row, the account and whether it is a refresh in the brief', () => {
    const brief = researchBrief({
      researchId: 'r2',
      userId: 'u1',
      companyName: 'Acme',
      companySlug: 'acme',
      previousId: 'r1',
    });
    expect(brief).toBe('Company research r2\nuser_id u1\ncompany Acme (acme)\nrefresh of r1');
  });
});
