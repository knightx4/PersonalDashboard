import { describe, expect, it } from 'vitest';
import { evidencePrompt, loggableContent, readEvidence, typeFromDomain } from './evidence';
import { argumentMap, EMPTY_PLAN, withEvidence, withPoint, withThesis } from './plan';

const cite = (url: string, cited_text: string, title = 'A page') => ({
  type: 'web_search_result_location',
  url,
  title,
  cited_text,
  encrypted_index: 'secret',
});
const text = (t: string, citations?: unknown[]) => ({
  type: 'text',
  text: t,
  ...(citations ? { citations } : {}),
});

describe('evidence for a point', () => {
  const reply = [
    {
      type: 'server_tool_use',
      name: 'web_search',
      input: { query: 'COSO generative AI preventive controls' },
    },
    {
      type: 'web_search_tool_result',
      content: [
        {
          type: 'web_search_result',
          url: 'https://www.coso.org/generative-ai',
          encrypted_content: 'xxx',
        },
      ],
    },
    text('- [standard-setter] '),
    text(
      '**COSO asks for preventive controls first**: COSO’s 2026 guidance calls for preventive, detective and corrective controls.',
      [
        cite(
          'https://www.coso.org/generative-ai',
          'preventive, detective, and corrective controls',
          'Generative AI | COSO',
        ),
      ],
    ),
    text('\n- [vendor] **A blog says so too**: but nothing cites it.\n- [press] '),
    text('**Fed scope note**: SR 26-2 says generative AI is out of scope.', [
      cite(
        'https://www.federalreserve.gov/supervisionreg/srletters/SR2602.htm',
        'are not within the scope of this guidance',
      ),
    ]),
  ];

  it('keeps cited items, labels the publisher from the address over the model, and drops uncited ones', () => {
    const items = readEvidence(reply, 'rule');
    expect(items.map((i) => [i.title, i.sourceType, i.domain])).toEqual([
      ['COSO asks for preventive controls first', 'standard-setter', 'coso.org'],
      ['Fed scope note', 'regulator', 'federalreserve.gov'],
    ]);
    expect(items[0]!.quote).toBe('preventive, detective, and corrective controls');
  });

  it('logs the response without the encrypted payloads', () => {
    const logged = JSON.stringify(loggableContent(reply));
    expect(logged).not.toContain('encrypted');
    expect(logged).toContain('preventive, detective');
  });

  it('asks for the governing rule by name and never sends the origin answer', () => {
    const prompt = evidencePrompt({
      question: 'Q?',
      thesis: 'T.',
      reader: 'CFOs',
      point: 'Prefer preventive.',
      kind: 'rule',
    });
    expect(prompt).toContain('identifier');
    expect(prompt).toContain('Prefer preventive.');
  });

  it('knows a regulator and a standard-setter by address', () => {
    expect(typeFromDomain('pcaobus.org')).toBe('regulator');
    expect(typeFromDomain('nvlpubs.nist.gov')).toBe('regulator');
    expect(typeFromDomain('coso.org')).toBe('standard-setter');
    expect(typeFromDomain('pluvo.io')).toBeNull();
  });
});

describe('the argument map', () => {
  it('names the gaps: no thesis, unsupported points, no objection', () => {
    const plan = withPoint(
      withPoint(EMPTY_PLAN, 'Prefer preventive controls.'),
      'Keep a human in the loop.',
    );
    expect(argumentMap(plan).gaps).toEqual(['no-thesis', 'unsupported', 'no-objection']);
  });

  it('counts a point supported once it has a rule, and an objection once there is evidence against', () => {
    let plan = withThesis(
      withPoint(EMPTY_PLAN, 'Prefer preventive controls.'),
      'Treat AI as part preparer, part system.',
    );
    const item = {
      sourceType: 'standard-setter' as const,
      title: 'COSO',
      summary: 's',
      quote: 'q',
      url: 'https://www.coso.org/generative-ai',
      sourceTitle: 'COSO',
      domain: 'coso.org',
      take: '',
    };
    plan = withEvidence(plan, 'p1', [
      { ...item, kind: 'rule' },
      { ...item, kind: 'against', quote: 'q2' },
    ]);
    const map = argumentMap(plan);
    expect(map.reasons[0]!.counts).toEqual({ rule: 1, for: 0, against: 1, case: 0 });
    expect(map.gaps).toEqual([]);
    expect(map.sources).toBe(1);
  });
});
