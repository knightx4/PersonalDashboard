'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { lookUpJobDescription } from '../actions';

/**
 * Reads a role's description off the employer's board the first time its
 * page opens with a posting link and no description (note 1efa0fe4). A role
 * saved with its link, by Dash, capture or a recommendation, otherwise waited
 * for Look it up to be pressed or for the nightly pass to reach its company.
 *
 * The page mounts this only while the board has never been asked
 * (`jd_lookup_at` is null). The lookup stamps that time whatever it finds,
 * so it runs once per role, and a role it could not fill says why on the
 * Posting tab, where Look it up stays to try again.
 */
export function AutoLookup({ roleId }: { roleId: string }) {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void lookUpJobDescription(roleId)
      .then(() => router.refresh())
      // Nothing to show for a failure here: the Posting tab's note and its
      // Look it up button are where a lookup's outcome is read.
      .catch(() => {});
  }, [roleId, router]);

  return null;
}
