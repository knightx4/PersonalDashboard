/** The three marks on an application row, as the role page's tabs receive them. */
export interface ApplicationMarks {
  readyToApply: boolean;
  /** Every question the application form asks has been added. */
  allQuestionsAdded: boolean;
  /** true yes, false no, null not answered. */
  hasCoverLetter: boolean | null;
}

/** Reads the marks off an applications row, defaulting what the row lacks. */
export function marksFromRow(row: {
  ready_to_apply?: unknown;
  all_questions_added?: unknown;
  has_cover_letter?: unknown;
}): ApplicationMarks {
  return {
    readyToApply: row.ready_to_apply === true,
    allQuestionsAdded: row.all_questions_added === true,
    hasCoverLetter: typeof row.has_cover_letter === 'boolean' ? row.has_cover_letter : null,
  };
}
