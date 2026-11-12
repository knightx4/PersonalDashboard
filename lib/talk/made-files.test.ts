import { describe, expect, it } from 'vitest';
import { fetchMadeFiles, madeFileIds, madeFileName, madeFilesNote, MAX_MADE_FILES } from './made-files';

const ran = (...ids: string[]) => ({
  type: 'bash_code_execution_tool_result',
  content: {
    type: 'bash_code_execution_result',
    return_code: 0,
    content: ids.map((file_id) => ({ type: 'bash_code_execution_output', file_id })),
  },
});

describe('madeFileIds (plan #3050.3.1)', () => {
  it('reads every file the code wrote, in order and once each', () => {
    expect(madeFileIds([{ type: 'text' }, ran('a', 'b'), ran('b', 'c')])).toEqual(['a', 'b', 'c']);
  });

  it('reads the older result shape, and nothing from a run that failed', () => {
    expect(
      madeFileIds([
        { type: 'code_execution_tool_result', content: { content: [{ type: 'code_execution_output', file_id: 'old' }] } },
        { type: 'bash_code_execution_tool_result', content: { type: 'bash_code_execution_tool_result_error', error_code: 'unavailable' } },
      ]),
    ).toEqual(['old']);
  });
});

describe('madeFileName', () => {
  it('keeps the last part of the path, and gives a bare name the extension its type says', () => {
    expect(madeFileName('/tmp/outputs/markets.png', 'image/png')).toBe('markets.png');
    expect(madeFileName('report', 'application/pdf')).toBe('report.pdf');
    expect(madeFileName('chart.svg', 'image/svg+xml')).toBe('chart.svg');
    expect(madeFileName(undefined, undefined)).toBe('file');
  });
});

type Served = Record<string, { filename: string; mime_type: string; size_bytes: number; bytes?: number[]; fails?: boolean }>;

function filesClient(files: Served) {
  return {
    get: async (path: string) => {
      const id = /\/v1\/files\/([^/]+)/.exec(path)?.[1] ?? '';
      const file = files[id];
      if (!file) throw new Error('not found');
      if (path.endsWith('/content')) {
        if (file.fails) throw new Error('gone');
        return new Response(new Uint8Array(file.bytes ?? [1, 2, 3]));
      }
      return { filename: file.filename, mime_type: file.mime_type, size_bytes: file.size_bytes };
    },
  } as never;
}

describe('fetchMadeFiles', () => {
  it('reads a picture and a PDF, and names what it could not keep with the reason', async () => {
    const { files, unkept } = await fetchMadeFiles(
      filesClient({
        png: { filename: 'markets.png', mime_type: 'image/png', size_bytes: 3 },
        pdf: { filename: 'summary.pdf', mime_type: 'application/pdf', size_bytes: 3 },
        svg: { filename: 'chart.svg', mime_type: 'image/svg+xml', size_bytes: 3 },
        big: { filename: 'huge.png', mime_type: 'image/png', size_bytes: 21 * 1024 * 1024 },
      }),
      ['png', 'pdf', 'svg', 'big'],
    );
    expect(files.map((f) => [f.name, f.contentType, f.bytes.byteLength])).toEqual([
      ['markets.png', 'image/png', 3],
      ['summary.pdf', 'application/pdf', 3],
    ]);
    expect(unkept).toEqual([
      { name: 'chart.svg', why: expect.stringContaining('cannot be kept here') },
      { name: 'huge.png', why: 'it is over 20 MB' },
    ]);
  });

  it('keeps four at most, and says so of the rest', async () => {
    const served: Served = {};
    const ids = Array.from({ length: MAX_MADE_FILES + 1 }, (_, i) => `f${i}`);
    for (const id of ids) served[id] = { filename: `${id}.png`, mime_type: 'image/png', size_bytes: 3 };
    const { files, unkept } = await fetchMadeFiles(filesClient(served), ids);
    expect(files).toHaveLength(MAX_MADE_FILES);
    expect(unkept).toEqual([{ name: 'f4.png', why: 'a reply keeps 4 files at most' }]);
  });

  it('names a file that could not be read', async () => {
    const { files, unkept } = await fetchMadeFiles(
      filesClient({ gone: { filename: 'gone.pdf', mime_type: 'application/pdf', size_bytes: 3, fails: true } }),
      ['gone', 'missing'],
    );
    expect(files).toEqual([]);
    expect(unkept.map((f) => f.name)).toEqual(['gone.pdf', 'One file']);
  });
});

describe('madeFilesNote', () => {
  it('says nothing when every file was kept, and names each that was not', () => {
    expect(madeFilesNote([])).toBeNull();
    expect(madeFilesNote([{ name: 'chart.svg', why: 'that kind of file cannot be kept here' }])).toBe(
      'Sorry, a file did not come through. chart.svg could not be saved: that kind of file cannot be kept here.',
    );
    expect(madeFilesNote([{ name: 'a.png', why: 'x' }, { name: 'b.png', why: 'y' }])).toMatch(/^Sorry, some files did not come through\./);
  });
});
