import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readLinkedInArchive, isNotLinkedInExport, skippedArchiveFiles } from '@/lib/linkedin/archive';
import { countsSentence, importUploadPath, kindLabel, runView } from './linkedin-import';

const fixture = new Uint8Array(readFileSync(join(__dirname, '../linkedin/archive/fixtures/export.zip')));

describe('the LinkedIn tab of Jobs settings (plan #2432.9)', () => {
  it('lists the files an export leaves out, and why', () => {
    const archive = readLinkedInArchive(fixture);
    const skipped = skippedArchiveFiles(archive);
    expect(isNotLinkedInExport(archive)).toBe(false);
    for (const path of archive.unread) {
      expect(skipped).toContainEqual({ path, reason: 'Not a kind of record the import reads.' });
    }
    for (const file of skipped) expect(file.reason).toMatch(/[.!?]$/);
  });

  it('reads a zip with none of LinkedIn’s files as not an export', () => {
    expect(
      isNotLinkedInExport({ files: [{ path: 'IMG_0001.jpg', kind: null, records: 0, duplicates: 0, problems: [] }] } as never),
    ).toBe(true);
  });

  it('keeps an upload in the person’s own folder', () => {
    expect(importUploadPath('u1', 'abc', 'Basic LinkedIn Export (1).zip')).toBe('u1/abc-Basic_LinkedIn_Export_1_.zip');
  });

  it('names kinds and counts in words', () => {
    expect(kindLabel('savedJobs')).toBe('Saved jobs');
    expect(kindLabel('some_new_kind')).toBe('Some new kind');
    expect(countsSentence({ added: 1392, updated: 4, unchanged: 0, kept: 0, skipped: 2 }, 'done')).toBe(
      '1,392 added, 4 changed, 2 skipped',
    );
    expect(countsSentence({ added: 0, updated: 0, unchanged: 0, kept: 0, skipped: 0 }, 'plan')).toBe('Nothing');
  });

  it('reads a run row with its counts per kind and skipped files', () => {
    const run = runView(
      {
        id: 'r1',
        created_at: '2026-10-19T10:00:00Z',
        archive_date: '2026-10-19',
        status: 'applied',
        counts: { applications: { added: 3, updated: 1, unchanged: 0, kept: 2, skipped: 0 }, messages: { added: 5 } },
        error: null,
        skipped_files: [{ path: 'Ad_Targeting.csv', reason: 'Not a kind of record the import reads.' }],
      },
      { ran: () => 'ran', exported: (d) => `made ${d}` },
    );
    expect(run.totals).toEqual({ added: 8, updated: 1, unchanged: 0, kept: 2, skipped: 0 });
    expect(run.kinds.map((k) => k.label)).toEqual(['Applications', 'Messages']);
    expect(run.exportDate).toBe('made 2026-10-19');
    expect(run.skipped).toHaveLength(1);
  });
});
