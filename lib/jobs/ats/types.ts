export interface FetchedQuestion {
  text: string;
  required: boolean;
  /** Greenhouse reports input_text, textarea, multi_value_single_select, … */
  inputType: string | null;
}

export interface FetchedPosting {
  vendor: string;
  title: string;
  text: string;
  url: string | null;
  location: string | null;
  atsJobId: string | null;
  boardToken: string | null;
  /** Empty for every vendor except Greenhouse; the bookmarklet fills the gap. */
  questions: FetchedQuestion[];
}
