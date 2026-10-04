/** A person you could name as having referred you, for the channel pickers. */
export type ReferrerOption = { id: string; name: string; company: string | null };

type ContactRow = {
  id: unknown;
  full_name: unknown;
  companies?: { name?: unknown } | { name?: unknown }[] | null;
};

/** Contacts as picker options, named with their company where there is one. */
export function referrerOptions(rows: readonly ContactRow[]): ReferrerOption[] {
  return rows.map((row) => {
    const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
    return {
      id: row.id as string,
      name: row.full_name as string,
      company: (company?.name as string | undefined) ?? null,
    };
  });
}

/** How one option reads in a select. */
export function referrerLabel(option: ReferrerOption): string {
  return option.company ? `${option.name}, ${option.company}` : option.name;
}
