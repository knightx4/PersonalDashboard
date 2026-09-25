import { deflateRawSync } from 'node:zlib';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { CollectionField } from '@/lib/goals/collections';
import { docxText, documentXmlText } from '@/lib/goals/docx';
import {
  documentContentType,
  documentKind,
  documentPath,
  extractionTool,
  matchRows,
  ownsDocumentPath,
  parseDate,
  readAsOf,
  readCautions,
  readExtraction,
  readSuggestions,
  suggestedKey,
} from '@/lib/goals/extract';
import { askExtractModel, type ExtractSource } from '@/lib/goals/extract-model';
import { readIntoForm } from '@/lib/goals/extract-read';

const loans: CollectionField[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'servicer', label: 'Servicer', type: 'text' },
  { key: 'balance', label: 'Balance', type: 'money', tracked: true },
  { key: 'rate', label: 'Rate', type: 'percent' },
  { key: 'minimum', label: 'Minimum', type: 'money' },
  { key: 'due_day', label: 'Due day', type: 'day_of_month' },
  { key: 'old', label: 'Old', type: 'text', removed: true },
];
const collection = { name: 'loans', shape: 'list' as const, fields: loans };

const USER = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685';
const FILE_ID = '0b6f3c1e-8a2d-4f7b-9c1a-2d3e4f5a6b7c';

/** A model stub that records what it was given and answers with these records. */
function stub(records: unknown[]) {
  const given: ExtractSource[] = [];
  return {
    given,
    ask: async (source: ExtractSource) => {
      given.push(source);
      return { ok: true as const, input: { records } };
    },
  };
}

/** A zip holding the named entries, deflated, as a .docx is. */
function zip(entries: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const body = deflateRawSync(Buffer.from(text));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(text.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(text.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

describe('readIntoForm, with the model stubbed', () => {
  it('fills the loans table from a pasted servicer page', async () => {
    const model = stub([
      { name: 'Loan 1-01', servicer: 'Nelnet', balance: 12450.37, rate: 6.8, minimum: 145, due_day: 15 },
      { name: 'Loan 1-02', servicer: 'Nelnet', balance: 3100, rate: 4.53, minimum: null, due_day: null },
    ]);
    const result = await readIntoForm(
      collection,
      { text: '  Loan 1-01  Principal balance $12,450.37 ...  ' },
      model.ask,
    );
    expect(model.given).toEqual([{ kind: 'text', text: 'Loan 1-01  Principal balance $12,450.37 ...' }]);
    expect(result).toEqual({
      ok: true,
      rows: [
        { name: 'Loan 1-01', servicer: 'Nelnet', balance: '12450.37', rate: '6.8', minimum: '145', due_day: '15' },
        { name: 'Loan 1-02', servicer: 'Nelnet', balance: '3100', rate: '4.53', minimum: '', due_day: '' },
      ],
      asOf: null,
      suggestions: [],
      cautions: [],
    });
  });

  it('hands back the date the document gives its figures as of (plan #985)', async () => {
    const ask = async () => ({
      ok: true as const,
      input: { as_of: '2026-09-02', records: [{ name: 'Loan', balance: 10 }] },
    });
    const result = await readIntoForm(collection, { text: 'NSLDS file' }, ask);
    expect(result).toMatchObject({ ok: true, asOf: '2026-09-02' });
  });

  it('sends a statement PDF and a screenshot to the model as themselves', async () => {
    const model = stub([{ name: 'Loan', balance: 10 }]);
    const bytes = new Uint8Array([37, 80, 68, 70]);
    await readIntoForm(collection, { name: `${USER}/${FILE_ID}-May.pdf`, bytes }, model.ask);
    await readIntoForm(collection, { name: 'shot.PNG', bytes }, model.ask);
    expect(model.given).toEqual([
      { kind: 'pdf', data: 'JVBERg==' },
      { kind: 'image', data: 'JVBERg==', mediaType: 'image/png' },
    ]);
  });

  it('reads a Word file as its text, a paragraph to a line and a tab between cells', async () => {
    const model = stub([{ name: 'Loan', balance: 10 }]);
    const xml =
      '<w:document><w:body><w:p><w:r><w:t>Loans &amp; rates</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Loan 1</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>$12,450.37</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
    const file = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': xml });
    await readIntoForm(collection, { name: 'loans.docx', bytes: file }, model.ask);
    expect(model.given[0]).toEqual({ kind: 'text', text: 'Loans & rates\nLoan 1\n\t$12,450.37' });
  });

  it('refuses what it cannot read before asking the model', async () => {
    const model = stub([]);
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await readIntoForm(collection, { text: '   ' }, model.ask)).toEqual({
      ok: false,
      error: 'Paste some text first.',
    });
    expect((await readIntoForm(collection, { name: 'a.doc', bytes }, model.ask)).ok).toBe(false);
    expect(await readIntoForm(collection, { name: 'a.docx', bytes }, model.ask)).toEqual({
      ok: false,
      error: 'That Word file could not be opened.',
    });
    expect(model.given).toEqual([]);
  });

  it('says so when nothing fits, and passes on a failed call', async () => {
    expect(await readIntoForm(collection, { text: 'hello' }, stub([{ name: null }]).ask)).toEqual({
      ok: false,
      error: 'Nothing in that fits the loans form.',
    });
    expect(
      await readIntoForm(collection, { text: 'hello' }, async () => ({ ok: false, error: 'Rate-limited.' })),
    ).toEqual({ ok: false, error: 'Rate-limited.' });
  });
});

describe('readExtraction', () => {
  it('keeps a value the form would refuse, as written, for you to correct', () => {
    const rows = readExtraction(loans, 'list', {
      records: [{ name: 'Loan', balance: 12.345, rate: '6.8%', due_day: 40, old: 'x', extra: 'y' }],
    });
    expect(rows).toEqual([
      { name: 'Loan', servicer: '', balance: '12.345', rate: '6.8', minimum: '', due_day: '40' },
    ]);
  });

  it('keeps one row for a one-record form, and ignores an answer of the wrong shape', () => {
    const answer = { records: [{ name: 'A' }, { name: 'B' }] };
    expect(readExtraction(loans, 'one', answer)).toHaveLength(1);
    expect(readExtraction(loans, 'list', answer)).toHaveLength(2);
    expect(readExtraction(loans, 'list', { records: 'A' })).toEqual([]);
    expect(readExtraction(loans, 'list', null)).toEqual([]);
    expect(readExtraction(loans, 'list', { records: [null, [1], { name: { a: 1 } }] })).toEqual([]);
  });

  it('shows yes and no, and a choice by its option', () => {
    const fields: CollectionField[] = [
      { key: 'autopay', label: 'Autopay', type: 'yes_no' },
      { key: 'plan', label: 'Plan', type: 'choice', options: ['Standard', 'SAVE'] },
    ];
    expect(readExtraction(fields, 'one', { records: [{ autopay: true, plan: 'save' }] })).toEqual([
      { autopay: 'yes', plan: 'SAVE' },
    ]);
  });
});

describe('suggested fields and cautions (plan #986)', () => {
  it('suggests what an NSLDS export has and the loans form lacks, and passes on its warning', async () => {
    const ask = async () => ({
      ok: true as const,
      input: {
        as_of: '2026-09-02',
        records: [
          { name: 'Direct Unsubsidized', balance: 20500 },
          { name: null, balance: null },
          { name: 'Grad PLUS', balance: 31000 },
        ],
        extra: [
          {
            label: 'Loan ID', type: 'text', options: null, identifies: true,
            values: ['DU-1', null, 'GP-1'], why: 'Matches next month’s export to these loans.',
          },
          {
            label: 'Status', type: 'choice', options: ['In school', 'Repayment'], identifies: false,
            values: ['In school', null, 'Repayment'], why: 'Says whether payments are due yet.',
          },
          {
            label: 'Next payment due', type: 'date', options: null, identifies: false,
            values: [null, null, '2026-12-18'], why: 'When the first payment falls.',
          },
          {
            label: 'Principal', type: 'money', options: null, identifies: false,
            values: [20000, null, 30000], why: 'What interest accrues on.',
          },
          {
            label: 'Interest', type: 'money', options: null, identifies: false,
            values: [500, null, 1000], why: 'Unpaid interest that may capitalise.',
          },
          { label: 'Balance', type: 'money', options: null, identifies: false, values: [1, null, 2], why: '' },
          { label: 'Servicer phone', type: 'text', options: null, identifies: false, values: [null, null, null], why: '' },
        ],
        caution: [
          {
            label: 'Repayment Begin Date', field: null,
            note: 'For the Grad PLUS loan this is the last disbursement date, not when payments start.',
          },
        ],
      },
    });
    const result = await readIntoForm(collection, { text: 'NSLDS file' }, ask);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows.map((r) => r.name)).toEqual(['Direct Unsubsidized', 'Grad PLUS']);
    expect(result.suggestions.map((s) => [s.field.key, s.field.type, s.values])).toEqual([
      ['loan_id', 'text', ['DU-1', 'GP-1']],
      ['status', 'choice', ['In school', 'Repayment']],
      ['next_payment_due', 'date', ['', '2026-12-18']],
      ['principal', 'money', ['20000', '30000']],
      ['interest', 'money', ['500', '1000']],
    ]);
    expect(result.suggestions[0].field.id).toBe(true);
    expect(result.suggestions[1].field.options).toEqual(['In school', 'Repayment']);
    expect(result.cautions).toEqual([
      {
        label: 'Repayment Begin Date',
        field: null,
        note: 'For the Grad PLUS loan this is the last disbursement date, not when payments start.',
      },
    ]);
  });

  it('takes a fresh key, never marks a second ID, and makes a choice with no options text', () => {
    const withId: CollectionField[] = [
      ...loans,
      { key: 'loan_id', label: 'Loan number', type: 'text', id: true },
    ];
    const input = {
      extra: [
        { label: 'Old', type: 'text', identifies: true, values: ['x'], why: '' },
        { label: 'Account', type: 'text', identifies: true, values: ['A-1'], why: '' },
        { label: 'Kind', type: 'choice', options: [], values: ['Federal'], why: '' },
        { label: 'Kind', type: 'text', values: ['again'], why: '' },
        { label: 'Weird', type: 'colour', values: ['red'], why: '' },
      ],
    };
    const suggested = readSuggestions(withId, input, [0]);
    expect(suggested.map((s) => s.field)).toEqual([
      { key: 'old_2', label: 'Old', type: 'text' },
      { key: 'account', label: 'Account', type: 'text' },
      { key: 'kind', label: 'Kind', type: 'text' },
    ]);
  });

  it('keys a label as lower case words joined by _', () => {
    expect(suggestedKey('Next Payment Due', new Set())).toBe('next_payment_due');
    expect(suggestedKey('Next Payment Due', new Set(['next_payment_due']))).toBe('next_payment_due_2');
    expect(suggestedKey('2nd rate (%)', new Set())).toBe('field_2nd_rate');
    expect(suggestedKey('', new Set())).toBe('field');
  });

  it('names a form field in a caution only when the form shows it', () => {
    expect(
      readCautions(loans, {
        caution: [
          { label: 'Due', field: 'due_day', note: 'The day after the cut-off.' },
          { label: 'Old', field: 'old', note: 'Not what it says.' },
          { label: 'Empty', field: null, note: '' },
        ],
      }),
    ).toEqual([
      { label: 'Due', field: 'due_day', note: 'The day after the cut-off.' },
      { label: 'Old', field: null, note: 'Not what it says.' },
    ]);
  });
});

describe('readAsOf', () => {
  it('takes a real date and nothing else', () => {
    expect(readAsOf({ as_of: ' 2026-09-02 ', records: [] })).toBe('2026-09-02');
    expect(readAsOf({ as_of: '2026-02-30' })).toBeNull();
    expect(readAsOf({ as_of: '2 Sep 2026' })).toBeNull();
    expect(readAsOf({ as_of: null })).toBeNull();
    expect(readAsOf(null)).toBeNull();
    expect(parseDate('1899-12-31')).toBeNull();
  });
});

describe('matchRows (plan #985)', () => {
  const withId: CollectionField[] = [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'loan_id', label: 'Loan ID', type: 'text', id: true },
    { key: 'balance', label: 'Balance', type: 'money', tracked: true },
  ];
  const saved = [
    { id: 'rec-a', data: { name: 'Grad PLUS', loan_id: '*****8042P25G01426001', balance: 80080.21 } },
    { id: 'rec-b', data: { name: 'Unsub', loan_id: '*****8042U25G01426001', balance: 23549.6 } },
    { id: 'rec-c', data: { name: 'No ID', loan_id: null, balance: 5 } },
  ];

  it('updates the saved row with the same ID, and adds the rest', () => {
    const rows = [
      { name: 'Grad PLUS', loan_id: ' *****8042p25g01426001 ', balance: '80500' },
      { name: 'New loan', loan_id: '*****8042U26G01426001', balance: '100' },
      { name: 'Unsub', loan_id: '*****8042U25G01426001', balance: '23549.60' },
      { name: 'Blank', loan_id: '', balance: '1' },
    ];
    expect(matchRows(withId, rows, saved)).toEqual(['rec-a', null, 'rec-b', null]);
  });

  it('matches nothing when the collection has no ID field', () => {
    expect(matchRows(loans, [{ name: 'Grad PLUS' }], saved)).toEqual([null]);
  });
});

describe('extractionTool', () => {
  it('asks for every shown field, typed, and none removed', () => {
    const tool = extractionTool(loans);
    const items = (tool.input_schema.properties as { records: { items: { properties: object; required: string[] } } })
      .records.items;
    expect(items.required).toEqual(['name', 'servicer', 'balance', 'rate', 'minimum', 'due_day']);
    expect(tool.input_schema.required).toEqual(['as_of', 'records', 'extra', 'caution']);
    const caution = (tool.input_schema.properties as { caution: { items: { properties: { field: { enum: unknown[] } } } } })
      .caution.items.properties.field;
    expect(caution.enum).toEqual(['name', 'servicer', 'balance', 'rate', 'minimum', 'due_day', null]);
    expect(items.properties).toMatchObject({
      balance: { type: ['number', 'null'] },
      due_day: { type: ['integer', 'null'] },
    });
  });
});

describe('documents', () => {
  it('knows what it can read by the extension', () => {
    expect(documentKind('Statement.PDF')).toEqual({ kind: 'pdf' });
    expect(documentKind('a.jpg')).toEqual({ kind: 'image', mediaType: 'image/jpeg' });
    expect(documentKind('a.docx')).toEqual({ kind: 'docx' });
    expect(documentKind('a.csv')).toEqual({ kind: 'text' });
    expect(documentKind('a.doc')).toBeNull();
    expect(documentKind('noextension')).toBeNull();
    expect(documentContentType('a.htm')).toBe('text/html');
    expect(documentContentType('a.exe')).toBeNull();
  });

  it('keeps each file in your own folder under a fresh id, and only those are yours', () => {
    const path = documentPath(USER, FILE_ID, 'May statement (Nelnet).pdf');
    expect(path).toBe(`${USER}/${FILE_ID}-May-statement-Nelnet-.pdf`);
    expect(ownsDocumentPath(USER, path)).toBe(true);
    expect(ownsDocumentPath('someone-else', path)).toBe(false);
    expect(ownsDocumentPath(USER, `${USER}/../other/${FILE_ID}-a.pdf`)).toBe(false);
    expect(documentPath(USER, FILE_ID, '../..')).toBe(`${USER}/${FILE_ID}-document`);
  });
});

describe('docx', () => {
  it('is null for a file that is not a zip, or a zip with no document', () => {
    expect(docxText(new Uint8Array(40))).toBeNull();
    expect(docxText(zip({ 'other.xml': '<a/>' }))).toBeNull();
  });

  it('decodes entities and line breaks', () => {
    expect(documentXmlText('<w:p><w:t>A&#x2019;s</w:t><w:br/><w:t>&lt;b&gt;</w:t></w:p>')).toBe('A’s\n<b>');
  });
});

describe('askExtractModel', () => {
  it('forces the form tool, reports the cost and hands back its input', async () => {
    const calls: Record<string, unknown>[] = [];
    const client = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params);
          return {
            usage: { input_tokens: 100, output_tokens: 20 },
            content: [{ type: 'tool_use', name: 'fill_form', id: 't', input: { records: [] } }],
          };
        },
      },
    } as unknown as Anthropic;
    const spent: unknown[] = [];
    const result = await askExtractModel(
      { apiKey: 'k', client, onSpend: (report) => spent.push(report) },
      collection,
      { kind: 'pdf', data: 'JVBERg==' },
    );
    expect(result).toEqual({ ok: true, input: { records: [] } });
    expect(spent).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tool_choice: { type: 'tool', name: 'fill_form' } });
    const content = (calls[0].messages as { content: { type: string }[] }[])[0].content;
    expect(content[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' } });
  });
});
