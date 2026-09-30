'use client';

import { CheckCourses, UploadForm } from '@/app/vault/education/add-transcript';
import { educationDraft } from './education-fixtures';

/**
 * The Education tab's two forms that take callbacks, wrapped on the client
 * side of the boundary: the gallery page is a server component and cannot
 * pass a function down (plan #1308).
 */
export function EducationUploadPreview() {
  return <UploadForm onRead={() => {}} onCancel={() => {}} />;
}

export function EducationCheckPreview() {
  return <CheckCourses draft={educationDraft} onDone={() => {}} />;
}
