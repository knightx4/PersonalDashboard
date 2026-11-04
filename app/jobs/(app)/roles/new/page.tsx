import { redirect } from 'next/navigation';
import { PIPELINE_PATH } from '@/lib/jobs/pipeline-view';

/**
 * Adding a role is Pipeline's Add a role button (plan #1496.7.1). Without
 * this page the address fell through to the role page as a role called
 * "new" and answered not found.
 */
export default function NewRoleRedirect() {
  redirect(PIPELINE_PATH);
}
