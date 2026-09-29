import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { CollectionField } from '@/lib/goals/collections';
import {
  editedNotes,
  findCorrections,
  kindsPrompt,
  learnKind,
  readKind,
  type LearnedKind,
} from '@/lib/goals/document-kinds';
import { extractionPrompt, extractionTool } from '@/lib/goals/extract';
import { askExtractModel } from '@/lib/goals/extract-model';
import { readIntoForm } from '@/lib/goals/extract-read';

/**
 * Remembering how a kind of document fills a form (plan #987), with the
 * model's answers faked: a session has no API key, so what a live read does
 * with the notes is not checked here, only that the notes are kept, handed
 * to the reader, and that its answer is read back against them. The NSLDS
 * export is the worked case; nothing here is particular to loans.
 */

const loans: CollectionField[] = [
  { key: 'name', label: 'Loan', type: 'text' },
  { key: 'balance', label: 'Balance', type: 'money', tracked: true },
  { key: 'first_payment', label: 'First payment', type: 'date' },
];
const KIND_ID = '6b1f0c7e-3d2a-4c5b-8e9f-0a1b2c3d4e5f';
const COLLECTION_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const firstAnswer = {
  as_of: '2026-09-02',
  records: [
    { name: 'Direct Unsubsidized', balance: 20500, first_payment: null },
    { name: 'Grad PLUS', balance: 31000, first_payment: '2026-06-10' },
  ],
  extra: [
    { label: 'Loan ID', from: 'Loan ID', type: 'text', options: null, identifies: true, values: ['DU-1', 'GP-1'], why: 'Matches next month’s export.' },
    { label: 'Next payment due', from: 'Next Payment Due Date', type: 'date', options: null, identifies: false, values: [null, '2026-12-18'], why: 'When payments start.' },
    { label: 'Principal', from: 'Outstanding Principal', type: 'money', options: null, identifies: false, values: [20000, 30000], why: 'What interest accrues on.' },
  ],
  caution: [
    {
      label: 'Repayment Begin Date',
      field: 'first_payment',
      note: 'For Grad PLUS loans this is the last disbursement date; the first payment falls in the month of the Next Payment Due Date.',
    },
  ],
  kind: {
    known: null,
    name: 'NSLDS loan export',
    recognise: 'A text export from studentaid.gov headed "File Request Date", one block per loan.',
    labels: [
      { field: 'name', label: 'Loan Type Description' },
      { field: 'balance', label: 'Loan Outstanding Principal Balance' },
      { field: 'first_payment', label: 'Repayment Begin Date' },
    ],
  },
};

describe('a kind of document learned on the first read and used on the second', () => {
  it('names a new kind, and keeps what the person added, left out and corrected', async () => {
    const first = await readIntoForm(
      { name: 'Student loans', shape: 'list', fields: loans },
      { text: 'NSLDS export' },
      async () => ({ ok: true, input: firstAnswer }),
    );
    if (!first.ok) throw new Error(first.error);
    expect(first.kind).toMatchObject({ knownId: null, name: 'NSLDS loan export' });
    expect(first.suggestions.map((s) => [s.field.label, s.from])).toEqual([
      ['Loan ID', 'Loan ID'],
      ['Next payment due', 'Next Payment Due Date'],
      ['Principal', 'Outstanding Principal'],
    ]);

    // The person adds Loan ID and Next payment due, leaves Principal out, and
    // puts the Grad PLUS first payment right.
    const fields: CollectionField[] = [
      ...loans,
      { key: 'loan_id', label: 'Loan ID', type: 'text', id: true },
      { key: 'next_payment_due', label: 'Next payment due', type: 'date' },
    ];
    const read = first.rows.map((row, i) => ({
      ...row,
      loan_id: first.suggestions[0].values[i],
      next_payment_due: first.suggestions[1].values[i],
    }));
    const corrections = findCorrections(fields, [
      { read: read[0], start: {}, saved: { ...read[0] }, id: 'DU-1' },
      { read: read[1], start: {}, saved: { ...read[1], first_payment: '2026-12-18' }, id: 'GP-1' },
    ]);
    expect(corrections).toEqual([
      { key: 'first_payment', read: '2026-06-10', saved: '2026-12-18', row: 'GP-1' },
    ]);

    const write = learnKind(fields, [], {
      read: first.kind,
      added: [
        { key: 'loan_id', from: 'Loan ID' },
        { key: 'next_payment_due', from: 'Next Payment Due Date' },
      ],
      skipped: ['Outstanding Principal'],
      cautions: first.cautions,
      corrections,
      fallbackName: 'nslds.txt',
    });
    expect(write).not.toBeNull();
    expect(write?.id).toBeNull();
    expect(write?.name).toBe('NSLDS loan export');
    expect(write?.skipped).toEqual(['Outstanding Principal']);
    expect(write?.fieldNotes.first_payment).toBe(
      'Filled from "Repayment Begin Date". Trap: "Repayment Begin Date": for Grad PLUS loans this is the last disbursement date; the first payment falls in the month of the Next Payment Due Date. Corrected by hand for GP-1: the reader gave 2026-06-10, the right value was 2026-12-18.',
    );
    expect(write?.fieldNotes.next_payment_due).toBe('Filled from "Next Payment Due Date".');
  });

  const learned: LearnedKind = {
    id: KIND_ID,
    collectionId: COLLECTION_ID,
    name: 'NSLDS loan export',
    recognise: 'A text export from studentaid.gov headed "File Request Date", one block per loan.',
    fieldNotes: {
      first_payment:
        'Filled from "Repayment Begin Date". Trap: "Repayment Begin Date": for Grad PLUS loans this is the last disbursement date; the first payment falls in the month of the Next Payment Due Date.',
      gone: 'A note for a field the form no longer has.',
    },
    skipped: ['Outstanding Principal'],
    senders: [],
    lastReadAt: null,
  };
  const fields: CollectionField[] = [
    ...loans,
    { key: 'loan_id', label: 'Loan ID', type: 'text', id: true },
    { key: 'next_payment_due', label: 'Next payment due', type: 'date' },
  ];

  it('hands the reader every learned kind, its notes and what it leaves out', () => {
    const prompt = extractionPrompt('Student loans', 'list', [learned], fields);
    expect(prompt).toContain('Kind: "NSLDS loan export"');
    expect(prompt).toContain('Recognise it by: A text export from studentaid.gov');
    expect(prompt).toContain(
      '- First payment (first_payment): Filled from "Repayment Begin Date". Trap: "Repayment Begin Date": for Grad PLUS loans',
    );
    expect(prompt).toContain('do not list in extra: Outstanding Principal');
    expect(prompt).not.toContain('A note for a field the form no longer has.');

    const tool = extractionTool(fields, [learned]);
    const kind = (tool.input_schema.properties as { kind: { properties: { known: { enum: unknown[] } } } })
      .kind;
    expect(kind.properties.known.enum).toEqual(['NSLDS loan export', null]);
  });

  it('recognises the second export by name, suggests nothing new, and takes the start date as read', async () => {
    const second = await readIntoForm(
      { name: 'Student loans', shape: 'list', fields },
      { text: 'NSLDS export, October' },
      async () => ({
        ok: true,
        input: {
          as_of: '2026-10-02',
          records: [
            { name: 'Direct Unsubsidized', balance: 20600, first_payment: null, loan_id: 'DU-1', next_payment_due: null },
            { name: 'Grad PLUS', balance: 31150, first_payment: '2026-12-18', loan_id: 'GP-1', next_payment_due: '2026-12-18' },
          ],
          // The reader lists the principal again; the kind leaves it out.
          extra: [
            { label: 'Principal', from: 'Outstanding Principal', type: 'money', options: null, identifies: false, values: [20100, 30100], why: '' },
          ],
          caution: [],
          kind: { known: 'NSLDS loan export', name: 'NSLDS loan export', recognise: '', labels: [] },
        },
      }),
      [learned],
    );
    if (!second.ok) throw new Error(second.error);
    expect(second.kind).toMatchObject({ knownId: KIND_ID, name: 'NSLDS loan export' });
    expect(second.suggestions).toEqual([]);
    expect(second.rows[1].first_payment).toBe('2026-12-18');

    // Saving it changes no value, so the kind is only dated: its notes stay as they were.
    const write = learnKind(fields, [learned], {
      read: second.kind,
      added: [],
      skipped: [],
      cautions: [],
      corrections: [],
      fallbackName: 'october.txt',
    });
    expect(write).toEqual({
      id: KIND_ID,
      name: 'NSLDS loan export',
      recognise: learned.recognise,
      fieldNotes: { first_payment: learned.fieldNotes.first_payment },
      skipped: ['Outstanding Principal'],
    });
  });

  it('sends the learned kinds to the model in its instructions', async () => {
    const calls: Record<string, unknown>[] = [];
    const client = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params);
          return {
            usage: { input_tokens: 1, output_tokens: 1 },
            content: [{ type: 'tool_use', name: 'fill_form', id: 't', input: { records: [] } }],
          };
        },
      },
    } as unknown as Anthropic;
    await askExtractModel(
      { apiKey: 'k', client },
      { name: 'Student loans', shape: 'list', fields },
      { kind: 'text', text: 'x' },
      [learned],
    );
    expect(String(calls[0].system)).toContain('Kind: "NSLDS loan export"');
  });
});

describe('readKind', () => {
  const kinds: LearnedKind[] = [
    { id: KIND_ID, collectionId: COLLECTION_ID, name: 'Acme pay stub', recognise: 'Acme header', fieldNotes: {}, skipped: [], senders: [], lastReadAt: null },
  ];
  const pay: CollectionField[] = [{ key: 'net', label: 'Net pay', type: 'money' }];

  it('takes a new name the reader gives a learned kind as that kind', () => {
    const read = readKind({ kind: { known: null, name: 'ACME pay-stub', recognise: 'x', labels: [] } }, kinds, pay);
    expect(read).toMatchObject({ knownId: KIND_ID, name: 'Acme pay stub', recognise: 'Acme header' });
  });

  it('keeps labels only for the form’s live fields, and is null with no kind', () => {
    const read = readKind(
      { kind: { known: null, name: 'Lease', recognise: '', labels: [{ field: 'net', label: 'Net' }, { field: 'x', label: 'X' }] } },
      kinds,
      pay,
    );
    expect(read).toEqual({ knownId: null, name: 'Lease', recognise: '', labels: { net: 'Net' } });
    expect(readKind({ records: [] }, kinds, pay)).toBeNull();
  });
});

describe('findCorrections', () => {
  const fields: CollectionField[] = [
    { key: 'balance', label: 'Balance', type: 'money' },
    { key: 'due', label: 'Due', type: 'date' },
  ];

  it('counts neither a value written another way nor a saved value carried over', () => {
    expect(
      findCorrections(fields, [
        { read: { balance: '12450', due: '' }, start: { due: '2026-12-18' }, saved: { balance: '12,450.00', due: '2026-12-18' }, id: null },
      ]),
    ).toEqual([]);
  });

  it('counts a value the reader missed and the person filled', () => {
    expect(
      findCorrections(fields, [{ read: { balance: '', due: '' }, start: {}, saved: { balance: '', due: '2027-01-18' }, id: null }]),
    ).toEqual([{ key: 'due', read: '', saved: '2027-01-18', row: null }]);
  });
});

describe('learnKind', () => {
  const fields: CollectionField[] = [{ key: 'net', label: 'Net pay', type: 'money' }];

  it('writes nothing for a new kind that taught nothing', () => {
    expect(
      learnKind(fields, [], {
        read: { knownId: null, name: 'Acme pay stub', recognise: '', labels: { net: 'Net Pay' } },
        added: [],
        skipped: [],
        cautions: [],
        corrections: [],
        fallbackName: 'stub.pdf',
      }),
    ).toBeNull();
  });

  it('names a kind the reader did not name after the file, and does not repeat a note', () => {
    const lesson = {
      read: null,
      added: [],
      skipped: ['Employer address'],
      cautions: [],
      corrections: [{ key: 'net', read: '100', saved: '1000', row: null }],
      fallbackName: 'stub.pdf',
    };
    const write = learnKind(fields, [], lesson);
    expect(write).toMatchObject({ id: null, name: 'stub.pdf', skipped: ['Employer address'] });
    const again = learnKind(
      fields,
      [{ ...write!, id: KIND_ID, collectionId: COLLECTION_ID, senders: [], lastReadAt: null, recognise: '' }],
      { ...lesson, read: { knownId: KIND_ID, name: 'stub.pdf', recognise: '', labels: {} } },
    );
    expect(again?.fieldNotes.net).toBe(write?.fieldNotes.net);
    expect(again?.skipped).toEqual(['Employer address']);
  });
});

describe('editedNotes', () => {
  it('keeps each live field’s note, trimmed, and drops an empty one', () => {
    const fields: CollectionField[] = [
      { key: 'a', label: 'A', type: 'text' },
      { key: 'b', label: 'B', type: 'text' },
      { key: 'c', label: 'C', type: 'text', removed: true },
    ];
    const values: Record<string, string> = { a: '  From "A".  ', b: ' ', c: 'gone' };
    expect(editedNotes(fields, (key) => values[key])).toEqual({ a: 'From "A".' });
  });
});

describe('kindsPrompt', () => {
  it('only asks for the kind to be named when none is learned', () => {
    const prompt = kindsPrompt([], []);
    expect(prompt).toContain('In kind, say what kind of document this is');
    expect(prompt).not.toContain('has been filled from the kinds of document below');
  });
});
