import { describe, expect, it, vi } from 'vitest';
import { nameOpeningClaims } from './opening-claims';
import { MIN_CLAIMS, TARGET_CLAIMS } from './opening-payload';

/**
 * What comes back when somebody names a subject they have never studied.
 *
 * The rules doing the real work are in opening-payload.test.ts, without a
 * network. What is left here is the part that only makes sense around a call:
 * that the spend is reported even when the answer is useless, that nothing is
 * written, and that the three failures stay three -- something too broad to
 * have shared ground, a list too thin to span anything, and a call that broke.
 */

function clientReturning(input: unknown, usage?: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', name: 'report_claims', input }],
        usage,
      }),
    },
  };
}

function claims(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `Claim ${i}`,
    claim: `The ${i}th thing in this subject that somebody can be right or wrong about.`,
  }));
}

const ask = (client: unknown, onSpend?: (report: { model: string }) => void) =>
  nameOpeningClaims({
    asked: 'keynesian economics',
    anthropicApiKey: 'test',
    client: client as never,
    onSpend: onSpend as never,
  });

describe('when it names the claims', () => {
  it('returns the subject and ten of them', async () => {
    const result = await ask(clientReturning({ subject: 'Economics', claims: claims(TARGET_CLAIMS) }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subject).toBe('Economics');
    expect(result.claims).toHaveLength(TARGET_CLAIMS);
  });

  it('asks Sonnet once and nothing else', async () => {
    const client = clientReturning({ subject: 'Economics', claims: claims(TARGET_CLAIMS) });
    await ask(client);

    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(client.messages.create.mock.calls[0][0].model).toBe('claude-sonnet-5');
  });

  it('reports what it cost', async () => {
    const reports: { model: string }[] = [];
    await ask(
      clientReturning({ subject: 'Economics', claims: claims(TARGET_CLAIMS) }, { input_tokens: 900, output_tokens: 600 }),
      (report) => reports.push(report),
    );

    expect(reports).toHaveLength(1);
    expect(reports[0].model).toBe('claude-sonnet-5');
  });
});

describe('when it will not', () => {
  it('refuses something with no one subject in it', async () => {
    const result = await ask(
      clientReturning({ subject: 'Science', claims: [], no_structure: true }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-structure');
  });

  it('trusts the admission over the claims beside it', async () => {
    const result = await ask(
      clientReturning({ subject: 'Science', claims: claims(TARGET_CLAIMS), no_structure: true }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-structure');
  });

  it('refuses a list too thin to span the subject', async () => {
    const result = await ask(
      clientReturning({ subject: 'Economics', claims: claims(MIN_CLAIMS - 1) }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('too-few');
  });

  it('still reports what a useless answer cost', async () => {
    const reports: { model: string }[] = [];
    await ask(
      clientReturning({ subject: 'Economics', claims: claims(2) }, { input_tokens: 900, output_tokens: 20 }),
      (report) => reports.push(report),
    );

    expect(reports).toHaveLength(1);
  });

  it('says so when the call reports nothing', async () => {
    const client = {
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'hello' }] }) },
    };
    const result = await ask(client);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('error');
  });

  it('says so when the claims come back malformed', async () => {
    const result = await ask(clientReturning({ claims: 'not a list' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('error');
  });
});
