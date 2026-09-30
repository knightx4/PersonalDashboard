import type { AskDeclaration } from '@/lib/ask/declaration';

export const jobsAsk: AskDeclaration = {
  module: 'jobs',
  is: 'The person\'s job search.',
  holds: ['applications and where each stands', 'roles and companies', 'contacts', 'interviews', 'their own thoughts on the search'],
  readWith: ['job_applications', 'search', 'open_row'],
  whenEmpty: {
    job_applications: 'No application matched. Drop the status or date filter, or find the company with search.',
  },
};
