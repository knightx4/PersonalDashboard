'use client';

import { Thread } from '@/components/thread/thread';
import { threadRef } from '@/lib/thread/subjects';
import type { PanelProps } from './types';

/**
 * The Comments tab: the role's comment thread.
 *
 * Untagged, a comment is a note to yourself; tagged @dash, Dash answers from
 * the role, its description and your evidence bank, and "@dash write my cover
 * letter" writes one into the Application tab.
 */
export function RoleComments({ roleId, thread }: Pick<PanelProps, 'roleId' | 'thread'>) {
  return (
    <Thread
      subject={threadRef('role', roleId)}
      turns={thread}
      placeholder="Anything worth remembering about this role, or @dash write my cover letter."
    />
  );
}
