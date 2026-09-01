/**
 * Shape and validation for an AI company lookup, kept free of server-only
 * imports so the parsing rules can be tested directly (same split as
 * lib/sell/price-estimate.ts).
 */
import { z } from 'zod';

const urlLike = z
  .string()
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Not a URL');

export const companyLookupSchema = z.object({
  website: urlLike.nullable().optional().default(null),
  summary: z.string().trim().nullable().optional().default(null),
  sources: z
    .array(z.object({ title: z.string().nullable().optional(), url: z.string() }))
    .max(6)
    .optional()
    .default([]),
  no_data: z.boolean().optional().default(false),
});

export type CompanyLookup = z.infer<typeof companyLookupSchema>;

export type CompanyLookupResult =
  | { ok: true; website: string | null; summary: string | null; sources: Array<{ title: string | null; url: string }> }
  | { ok: false; error: string };

/** Validate a reported payload into a lookup, or explain why not. */
export function parseCompanyLookupPayload(raw: unknown): CompanyLookupResult {
  const parsed = companyLookupSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'The lookup came back in an unexpected shape.' };
  }
  const lookup = parsed.data;
  if (lookup.no_data) {
    return { ok: false, error: 'Could not find that company online with any confidence.' };
  }
  if (!lookup.website && !lookup.summary) {
    return { ok: false, error: 'Nothing usable came back.' };
  }
  return {
    ok: true,
    website: lookup.website || null,
    summary: lookup.summary || null,
    sources: lookup.sources.map((s) => ({ title: s.title ?? null, url: s.url })),
  };
}
