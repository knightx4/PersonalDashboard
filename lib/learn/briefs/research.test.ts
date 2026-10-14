import { describe, expect, it } from 'vitest';
import { briefFromRow, readFoundKind, readSections, readSubQuestions } from './model';
import {
  chooseReadings,
  finalText,
  kindFromDomain,
  readSearchResults,
  readSourceList,
  readSubQuestionLines,
  readWrittenBrief,
  researchBudget,
  READINGS_MAX,
} from './research';

const text = (t: string, citations?: unknown[]) => ({ type: 'text', text: t, ...(citations ? { citations } : {}) });
const loc = (document_index: number, cited_text: string) => ({
  type: 'char_location',
  document_index,
  cited_text,
  start_char_index: 0,
  end_char_index: cited_text.length,
});

const SUBS = [
  { id: 'q1', text: 'What does SOX section 404 require of internal controls?' },
  { id: 'q2', text: 'How do auditors test controls that rely on AI models?' },
  { id: 'q3', text: 'What have regulators said about AI in financial reporting?' },
];

const PAGES = [
  {
    url: 'https://pcaobus.org/ai',
    title: 'Staff spotlight on AI',
    domain: 'pcaobus.org',
    text: 'Auditors should  understand how a company uses generative AI in processes relevant to financial reporting.',
  },
  {
    url: 'https://www.sec.gov/404',
    title: 'Management report on ICFR',
    domain: 'sec.gov',
    text: 'Management must assess the effectiveness of internal control over financial reporting each year.',
  },
];

describe('framing', () => {
  it('reads three to five numbered sub-questions, numbering them q1 on', () => {
    const subs = readSubQuestionLines(
      'Here are some:\n1. What does SOX require?\n2) **How are AI controls tested?**\n- Who regulates this area?\n3. What does SOX require?\n4. ok\n5. A fourth real question here?\n6. A fifth one here?\n7. A sixth, dropped?',
    );
    expect(subs).toEqual([
      { id: 'q1', text: 'What does SOX require?' },
      { id: 'q2', text: 'How are AI controls tested?' },
      { id: 'q3', text: 'Who regulates this area?' },
      { id: 'q4', text: 'A fourth real question here?' },
      { id: 'q5', text: 'A fifth one here?' },
    ]);
  });

  it('searches two a sub-question, at most ten, and less on a quick brief', () => {
    expect(researchBudget('standard', 4)).toEqual({ searches: 8, pages: 5 });
    expect(researchBudget('standard', 5)).toEqual({ searches: 10, pages: 5 });
    expect(researchBudget('quick', 4)).toEqual({ searches: 4, pages: 3 });
    expect(researchBudget('deep', 3)).toEqual({ searches: 10, pages: 5 });
  });
});

describe('the search call', () => {
  const content = [
    { type: 'server_tool_use', name: 'web_search', input: { query: 'SOX 404 AI controls' } },
    {
      type: 'web_search_tool_result',
      content: [
        { type: 'web_search_result', url: 'https://pcaobus.org/ai#top', title: 'Staff spotlight on AI', page_age: 'July 2024' },
        { type: 'web_search_result', url: 'https://www.sec.gov/404', title: 'Management report on ICFR' },
        { type: 'web_search_result', url: 'http://old.example.com/x', title: 'Old' },
        { type: 'web_search_result', url: 'https://acme-ai.com/sox', title: 'Acme SOX automation' },
        { type: 'web_search_result', url: 'https://journal.example.org/ai-audit', title: 'AI and audit' },
      ],
    },
    { type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'too_many_requests' } },
    text('I will now read the pages.'),
    text(
      [
        'SOURCE: https://pcaobus.org/ai',
        'KIND: regulator',
        'WHY: The audit regulator on what auditors should check when AI is used.',
        'SUMMARY: The PCAOB staff describe how',
        'auditors should treat generative AI.',
        '',
        '**SOURCE:** <https://acme-ai.com/sox>',
        'KIND: Vendor',
        'WHY: A product page claiming to automate SOX testing.',
        'SUMMARY: Sells software.',
        '',
        'SOURCE: https://invented.example.com/made-up',
        'KIND: press',
        'WHY: Never retrieved.',
      ].join('\n'),
    ),
  ];

  it('reads every page the searches returned, once each, without fragments', () => {
    expect(readSearchResults(content)).toEqual([
      { url: 'https://pcaobus.org/ai', title: 'Staff spotlight on AI', pageAge: 'July 2024' },
      { url: 'https://www.sec.gov/404', title: 'Management report on ICFR', pageAge: null },
      { url: 'http://old.example.com/x', title: 'Old', pageAge: null },
      { url: 'https://acme-ai.com/sox', title: 'Acme SOX automation', pageAge: null },
      { url: 'https://journal.example.org/ai-audit', title: 'AI and audit', pageAge: null },
    ]);
  });

  it('reads the listed sources, with their kind, why line and a summary run over lines', () => {
    const listed = readSourceList(finalText(content));
    expect(listed).toEqual([
      {
        url: 'https://pcaobus.org/ai',
        kind: 'regulator',
        why: 'The audit regulator on what auditors should check when AI is used.',
        summary: 'The PCAOB staff describe how auditors should treat generative AI.',
      },
      { url: 'https://acme-ai.com/sox', kind: 'vendor', why: 'A product page claiming to automate SOX testing.', summary: 'Sells software.' },
      { url: 'https://invented.example.com/made-up', kind: 'press', why: 'Never retrieved.', summary: '' },
    ]);
  });

  it('reads kinds written loosely, and guesses one from an address', () => {
    expect(readFoundKind('Professional body')).toBe('professional_body');
    expect(readFoundKind('standard-setter')).toBe('regulator');
    expect(readFoundKind('consulting firm')).toBe('firm');
    expect(readFoundKind('news')).toBe('press');
    expect(readFoundKind('')).toBeNull();
    expect(kindFromDomain('sec.gov')).toBe('regulator');
    expect(kindFromDomain('pcaobus.org')).toBe('regulator');
    expect(kindFromDomain('ft.com')).toBe('press');
  });
});

describe('the write call', () => {
  const content = [
    text('Preamble that is dropped.\n## Q1\n'),
    text('Management assesses ICFR every year.', [loc(1, 'Management must assess the effectiveness of internal control over financial reporting each year.')]),
    text('\n\n## Q2: testing\n'),
    text('Auditors look at how AI is used.', [
      loc(0, 'Auditors should understand how a company uses generative AI'),
      loc(0, 'Auditors should understand how a company uses generative AI'),
      loc(1, 'a quote that is not in the page'),
      loc(7, 'out of range'),
    ]),
    text('\n## Q3\nNo page spoke to this, so no citation.\n## Q9\n'),
    text('A sub-question that does not exist.', [loc(0, 'Auditors should')]),
    text('\n## Short answer\nSOX asks management to stand behind its controls.\nAI changes how they are tested.'),
  ];

  it('keeps a position for each sub-question a fetched page backs, with the quotes found in that page', () => {
    const written = readWrittenBrief(content, PAGES, SUBS);
    expect(written.sections).toEqual([
      {
        subQuestionId: 'q1',
        position: 'Management assesses ICFR every year.',
        citations: [{ page: 1, quote: 'Management must assess the effectiveness of internal control over financial reporting each year.' }],
      },
      {
        subQuestionId: 'q2',
        position: 'Auditors look at how AI is used.',
        citations: [{ page: 0, quote: 'Auditors should understand how a company uses generative AI' }],
      },
    ]);
    expect(written.shortAnswer).toBe('SOX asks management to stand behind its controls. AI changes how they are tested.');
  });

  it('drops a position with no citation, and one for a sub-question that was never asked', () => {
    const written = readWrittenBrief(content, PAGES, SUBS);
    expect(written.sections.map((s) => s.subQuestionId)).not.toContain('q3');
    expect(written.sections).toHaveLength(2);
  });
});

describe('chooseReadings', () => {
  const results = [
    { url: 'https://pcaobus.org/ai', title: 'Staff spotlight on AI', pageAge: null },
    { url: 'https://www.sec.gov/404', title: 'Management report on ICFR', pageAge: null },
    { url: 'http://old.example.com/x', title: 'Old', pageAge: null },
    { url: 'https://acme-ai.com/sox', title: 'Acme', pageAge: null },
  ];
  const written = {
    sections: [
      { subQuestionId: 'q1', position: 'p', citations: [{ page: 1, quote: 'Management must assess' }] },
      { subQuestionId: 'q2', position: 'p', citations: [{ page: 0, quote: 'Auditors should' }] },
    ],
    shortAnswer: '',
  };

  it('puts quoted pages first, then the listed ones, and only pages the run retrieved over https', () => {
    const chosen = chooseReadings({
      pages: PAGES,
      results,
      listed: [
        { url: 'https://acme-ai.com/sox', kind: 'vendor', why: 'A vendor.', summary: 'Sells it.' },
        { url: 'https://pcaobus.org/ai', kind: 'regulator', why: 'The regulator.', summary: 'Staff view.' },
        { url: 'http://old.example.com/x', kind: 'press', why: 'Old.', summary: '' },
        { url: 'https://invented.example.com/x', kind: 'press', why: 'Made up.', summary: '' },
      ],
      written,
      subQuestions: SUBS,
    });
    expect(chosen).toEqual([
      {
        url: 'https://www.sec.gov/404',
        title: 'Management report on ICFR',
        kind: 'regulator',
        why: `Quoted in the answer to: ${SUBS[0].text}`,
        summary: null,
        page: 1,
      },
      { url: 'https://pcaobus.org/ai', title: 'Staff spotlight on AI', kind: 'regulator', why: 'The regulator.', summary: 'Staff view.', page: 0 },
      { url: 'https://acme-ai.com/sox', title: 'Acme', kind: 'vendor', why: 'A vendor.', summary: 'Sells it.', page: null },
    ]);
  });

  it('stops at twelve', () => {
    const many = Array.from({ length: 20 }, (_, i) => `https://s${i}.example.org/p`);
    const chosen = chooseReadings({
      pages: [],
      results: many.map((url) => ({ url, title: 'T', pageAge: null })),
      listed: many.map((url) => ({ url, kind: 'press' as const, why: 'Why.', summary: '' })),
      written: { sections: [], shortAnswer: '' },
      subQuestions: SUBS,
    });
    expect(chosen).toHaveLength(READINGS_MAX);
  });
});

describe('reading a brief row', () => {
  it('keeps the sub-questions and sections that fit their shape, and drops the rest', () => {
    expect(readSubQuestions([{ id: 'q1', text: 'A?' }, { id: 'q1', text: 'dup' }, { text: 'no id' }, 'x'])).toEqual([
      { id: 'q1', text: 'A?' },
    ]);
    expect(
      readSections([
        { sub_question_id: 'q1', position: 'P', citations: [{ reading_id: 'r1', quote: 'Q' }, { reading_id: 'r2' }] },
        { sub_question_id: 'q2', position: '' },
      ]),
    ).toEqual([{ sub_question_id: 'q1', position: 'P', citations: [{ reading_id: 'r1', quote: 'Q' }] }]);
    const brief = briefFromRow({
      id: 'b',
      track_id: null,
      question: 'How do SOX controls apply to AI?',
      angle: null,
      depth: 'odd',
      sub_questions: null,
      status: 'researching',
      stage: 'searching',
      error: null,
      sections: [],
      short_answer: null,
      short_answer_by: 'dash',
      watch_on: true,
      watched_at: null,
      quiet_checks: 0,
      archived_at: null,
      created_at: 't',
      updated_at: 't',
    });
    expect(brief).toMatchObject({ depth: 'standard', stage: 'searching', subQuestions: [], angle: '', shortAnswer: '' });
  });
});
