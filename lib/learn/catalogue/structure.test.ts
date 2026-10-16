import { describe, expect, it } from 'vitest';
import example from '@/lib/learn/providers/fixtures/structure/store-example.json';
import {
  isLicenceMode,
  mayFeedText,
  mayShowText,
  structureContentHash,
  structureRow,
  unitRows,
  unitText,
  type StructureDocumentInput,
} from './structure';

const doc = example as unknown as StructureDocumentInput;

describe('structureContentHash', () => {
  it('is the hex SHA-256 of the raw text, so the same text hashes the same', () => {
    const hash = structureContentHash(doc.rawText);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(structureContentHash(doc.rawText)).toBe(hash);
    expect(structureContentHash(`${doc.rawText} `)).not.toBe(hash);
  });
});

describe('unitText', () => {
  it('puts the label, heading, topics and readings in the text a unit is embedded by', () => {
    expect(unitText(doc.units[2])).toBe(
      [
        'Week 3: The French alliance and the war for independence',
        'Topics: Treaty of Alliance 1778; Saratoga',
        'Readings: Give Me Liberty! (ch. 5); Treaty of Alliance (1778)',
      ].join('\n'),
    );
  });

  it('is the heading alone for a unit with no label, topics or readings', () => {
    expect(unitText({ label: null, heading: 'Introduction', topics: [], readings: [] })).toBe('Introduction');
  });
});

describe('unitRows', () => {
  it('numbers the units from 0 in the order given', () => {
    const rows = unitRows(doc.units);
    expect(rows.map((row) => [row.ordinal, row.unit_label, row.heading])).toEqual([
      [0, 'Week 1', 'Colonial societies'],
      [1, 'Week 2', 'The imperial crisis'],
      [2, 'Week 3', 'The French alliance and the war for independence'],
    ]);
  });

  it('drops empty topics and readings and trims what is kept', () => {
    const [row] = unitRows([
      {
        label: '  ',
        heading: ' Week of nothing ',
        topics: ['', ' Saratoga '],
        readings: [{ title: ' ' }, { title: 'Foner', detail: ' ', url: ' https://example.edu ' }],
      },
    ]);
    expect(row).toMatchObject({
      unit_label: null,
      heading: 'Week of nothing',
      topics: ['Saratoga'],
      readings: [{ title: 'Foner', url: 'https://example.edu' }],
    });
  });

  it('refuses a unit with no heading', () => {
    expect(() => unitRows([{ label: 'Week 4', heading: ' ', topics: [], readings: [] }])).toThrow(/no heading/);
  });
});

describe('structureRow', () => {
  it('keeps the raw text whole and hashes it', () => {
    const row = structureRow(doc);
    expect(row.raw_text).toBe(doc.rawText);
    expect(row.content_hash).toBe(structureContentHash(doc.rawText));
    expect(row).toMatchObject({
      institution: 'Example University',
      course_code: 'HIS 315K',
      term: 'Fall 2024',
      licence_mode: 'structure_only',
      textbooks: ['Give Me Liberty! An American History, Eric Foner'],
      prerequisites: [],
    });
  });

  it('refuses an unknown licence mode and an empty raw text', () => {
    expect(() => structureRow({ ...doc, licenceMode: 'open' as never })).toThrow(/licence mode/);
    expect(() => structureRow({ ...doc, rawText: '  ' })).toThrow(/no raw text/);
  });
});

describe('licence modes', () => {
  it('lets only show text be shown or fed to a model', () => {
    expect(isLicenceMode('never_feed')).toBe(true);
    expect(isLicenceMode('open')).toBe(false);
    expect([mayShowText('show'), mayShowText('structure_only'), mayShowText('never_feed')]).toEqual([
      true,
      false,
      false,
    ]);
    expect([mayFeedText('show'), mayFeedText('structure_only'), mayFeedText('never_feed')]).toEqual([
      true,
      false,
      false,
    ]);
  });
});
