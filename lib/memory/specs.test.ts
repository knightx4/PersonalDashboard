import { describe, expect, it } from 'vitest';
import { SPEC_TABLE } from '@/lib/ask/dev';
import { SPECS, type SpecDoc } from '@/lib/specs/registry';
import { SPEC_SOURCE, specDocuments, syncSpecDocuments } from './specs';

/** The spec copy the memory sweep makes (plan #1321), against the real docs/. */

type Call = { fn: string; args: Record<string, unknown> };

function fakeClient(hashes: { source_ref: string; text_hash: string }[]) {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        if (fn === 'memory_document_hashes') return Promise.resolve({ data: hashes, error: null });
        return Promise.resolve({ data: (args.p_rows as unknown[]).length, error: null });
      },
    },
  };
}

describe('specDocuments', () => {
  it('cuts every spec at its sections, cited the way read_spec cites them', async () => {
    const { documents, missing } = await specDocuments();
    expect(missing).toBe(0);
    expect(SPEC_SOURCE).toBe(SPEC_TABLE);
    const refs = documents.map((doc) => doc.sourceRef);
    expect(new Set(refs).size).toBe(refs.length);
    for (const spec of SPECS) expect(refs).toContain(`${spec.slug}#opening`);
    expect(documents.every((doc) => /^[a-z0-9-]+#[\p{L}\p{N}-]+$/u.test(doc.sourceRef))).toBe(true);
  });

  it('changes a section hash when its text changes, and only that one', async () => {
    const read = (body: string) => async (spec: SpecDoc) => (spec.slug === 'writing' ? body : null);
    const one = await specDocuments(read('Intro.\n\n## Reward\n\nPlain words.\n\n## Penalize\n\nSlogans.'));
    const two = await specDocuments(read('Intro.\n\n## Reward\n\nPlain, short words.\n\n## Penalize\n\nSlogans.'));
    expect(one.documents.map((d) => d.sourceRef)).toEqual(['writing#opening', 'writing#reward', 'writing#penalize']);
    expect(one.documents[1].textHash).not.toBe(two.documents[1].textHash);
    expect(one.documents[2].textHash).toBe(two.documents[2].textHash);
    expect(one.missing).toBe(SPECS.length - 1);
  });
});

describe('syncSpecDocuments', () => {
  const read = async (spec: SpecDoc) => (spec.slug === 'writing' ? 'Intro.\n\n## Reward\n\nPlain words.' : null);

  it('sends only the sections that changed, with every ref still there', async () => {
    const { documents } = await specDocuments(read);
    const fake = fakeClient([{ source_ref: 'writing#opening', text_hash: documents[0].textHash }]);
    await syncSpecDocuments(fake.client, read);
    const sync = fake.calls.find((call) => call.fn === 'sync_memory_documents')!;
    expect(sync.args.p_refs).toEqual(['writing#opening', 'writing#reward']);
    expect((sync.args.p_rows as { source_ref: string }[]).map((r) => r.source_ref)).toEqual(['writing#reward']);
  });

  it('writes nothing when nothing changed', async () => {
    const { documents } = await specDocuments(read);
    const fake = fakeClient(documents.map((d) => ({ source_ref: d.sourceRef, text_hash: d.textHash })));
    expect(await syncSpecDocuments(fake.client, read)).toBe(0);
    expect(fake.calls.map((call) => call.fn)).toEqual(['memory_document_hashes']);
  });

  it('touches nothing when no spec could be read, so a missing docs/ cannot wipe them', async () => {
    const fake = fakeClient([{ source_ref: 'writing#opening', text_hash: 'x' }]);
    expect(await syncSpecDocuments(fake.client, async () => null)).toBe(0);
    expect(fake.calls).toEqual([]);
  });
});
